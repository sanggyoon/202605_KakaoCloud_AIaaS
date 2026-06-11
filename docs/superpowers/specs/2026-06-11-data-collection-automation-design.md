# 데이터 수집 자동화 + 매니저 수동 수집 개편 설계

**작성일:** 2026-06-11
**관련:** [[2026-06-08-auto-backfill-design]] (기존 영화 backfill 크론을 확장)

---

## 1. 목표

ML 학습용 데이터셋(≥1,000편)을 채우기 위해 수집을 자동화하고, 매니저 수동 수집을 타임아웃 없이 진행도·로그·에러까지 보이게 개편한다.

1. **영화 정보 크론**: 매일 03시(KST) 자동 수집, **100 → 300편**
2. **자막 데이터 크론**: 매일 04시(KST) 자동 수집 **300편** (신규)
3. **매니저 수동 수집**: 영화·자막 모두 **수량 입력** + **진행도·로그·에러** 표시. 큰 수량도 끝까지(타임아웃 없음).

---

## 2. 핵심 결정 (브레인스토밍 확정)

| 주제 | 결정 | 근거 |
|---|---|---|
| 수동 수집 실행 | **백그라운드 잡 + 폴링** | 스트리밍은 인그레스 ~60초(≈36~40편)에서 끊김. 300편+ 불가 |
| 잡 상태 저장 | **BE 인메모리 레지스트리** | BE 단일 레플리카, 수집 데이터는 DB에 즉시 커밋되어 안전. 표시용 상태만 메모리 |
| 크론 | **헤드리스 CronJob** (UI 표시 없음) | 로그는 파드 stdout(kubectl/ArgoCD) |
| 수집 로직 | `backfill_events`·`collect_events` **공유** | 크론=stdout, 수동=레지스트리로 동일 이벤트 소비 |
| 동시성 | 타입별 활성 잡 **1건** | 중복 클릭/중복 수집 방지 |

---

## 3. 아키텍처

```
[CronJob movie-backfill  18:00 UTC] → python -m app.backfill_popular (300) → stdout
[CronJob subtitle-collect 19:00 UTC] → python -m app.subtitle_collect (300) → stdout
                                                  │ 둘 다 동일 수집 로직 모듈 사용
매니저 버튼 ──POST(start)──▶ BE 백그라운드 asyncio 태스크
                              │ collect/backfill events 소비
                              ▼
                       인메모리 잡 레지스트리(타입별 1건: 진행도/로그/에러)
매니저 패널 ──GET 폴링(1~2s)──▶ 잡 상태 반환 → 진행바·로그·에러 렌더
```

수집 데이터 자체는 모든 경로에서 vm5 `processing_status`/`subtitles`(+vm4 `movies`)에 즉시 upsert되어 멱등. 잡 레지스트리 유실(파드 재시작)은 표시만 영향, 데이터는 안전하며 재실행으로 이어받음.

---

## 4. 컴포넌트

### 4.1 크론 (Ansible/manifests/4k-be/)

- **`backfill-cronjob.yaml`**: `BACKFILL_MAX_NEW` `100 → 300`.
- **`subtitle-cronjob.yaml`** (신규): CronJob `subtitle-collect`, ns `be`, `schedule: "0 19 * * *"`(04시 KST), `concurrencyPolicy: Forbid`, `command: ["python","-m","app.subtitle_collect"]`, env `SUBTITLE_MAX_NEW=300`, `envFrom 4k-be-secrets`, nodeSelector workload=app, 리소스는 backfill과 동일.
- **`kustomization.yaml`**: `resources`에 신규 cronjob 추가. (BE는 kustomize `images.newTag`로 모든 매니페스트 이미지를 일괄 덮어쓰므로 cronjob 매니페스트의 `:latest`는 그대로 두면 됨 — CI가 `newTag`만 갱신.)

### 4.2 BE: 자막 수집 CLI 진입점 (`4K_BE/app/subtitle_collect.py`)

`run()` + `__main__` 추가 (backfill_popular 패턴):
- env에서 `(max_new, rate_delay)` = `config_from_env()` 사용
- `httpx.AsyncClient`로 `collect_events(client, max_new, rate_delay)`를 끝까지 소비, 각 이벤트를 stdout 출력, 종료 시 요약 출력
- `if __name__ == "__main__": asyncio.run(run())`

### 4.3 BE: 인메모리 잡 매니저 (`4K_BE/app/jobs.py`, 신규)

- 모듈 전역 `_REGISTRY: dict[str, dict]` (key = "movie" | "subtitle").
- 잡 상태 스키마:
  ```
  {state: "idle"|"running"|"done"|"failed",
   processed: int, target: int,
   added: int, skipped: int, failed: list[int],
   log: list[str], error: str|None,
   started_at: str, finished_at: str|None}
  ```
- `start(job_type, agen_factory) -> dict`: 해당 타입이 `running`이면 **현재 상태 그대로 반환**(중복 방지). 아니면 새 상태 초기화 후 `asyncio.create_task(_run(...))`로 백그라운드 실행, 즉시 상태 반환.
- `_run(job_type, agen_factory)`: `async with httpx.AsyncClient(...)`로 `agen_factory(client)`(이벤트 async gen) 소비.
  - `progress` 이벤트 → `processed`/`target` 갱신 + 로그 줄 append (예: `tmdb=59 added: <title>` / `skipped` / `failed: <err>`). 로그는 최근 N줄(예: 500)로 캡.
  - `done` 이벤트 → `added/skipped/failed` 반영, `state="done"`, `finished_at`.
  - 예외 → `state="failed"`, `error=str(e)[:500]` (예: SubdlRateLimit, 네트워크).
- `get(job_type) -> dict`: 현재 상태(없으면 idle 기본).
- 로그 줄 형식을 위해 `progress` 이벤트가 결과/에러를 담도록 `collect_events`·`backfill_events`의 progress 페이로드를 보강(현재 title만 → result/err 추가). **변경 시 기존 스트리밍 테스트 갱신.**

### 4.4 BE: 엔드포인트 (`4K_BE/app/main.py`)

| 메서드/경로 | 변경 | 동작 |
|---|---|---|
| `POST /api/movies/backfill?limit=N` | 수정 | **limit 반영**(현재 무시). `jobs.start("movie", ...)` 시작, 잡 상태 즉시 반환 |
| `POST /api/subtitles/collect?limit=N` | 수정 | `jobs.start("subtitle", ...)` 시작, 즉시 반환 |
| `GET /api/jobs/{job_type}` | 신규 | 잡 상태/진행도/로그/에러 |
| `GET /api/subtitles/remaining` | 유지 | 자막 입력칸 최대치 |

두 POST는 기존 `StreamingResponse` → fire-and-forget + 폴링으로 전환.
`limit` 검증: 정수, 1~상한(예: 2000) 클램프.

### 4.5 FE: 매니저 (`4K_FE/app/manager/page.tsx`)

- **영화 정보 수집**: 수량 입력칸 추가(현재 고정 100) + 시작 버튼. (영화 backfill은 풀 상한이 없어 remaining 표시 없음 — 단순 숫자 입력.)
- **자막 데이터 수집**: 기존 수량 입력 + "최대 N개"(remaining) 유지.
- 공통 **폴링 패널**(기존 streamJob/JobBanner 대체):
  - 시작 → POST로 잡 기동 → `GET /api/jobs/{type}` 1~2초 폴링
  - 진행바(processed/target), **로그 영역**(스크롤, 영화별 줄), **에러 박스**(잡 실패 사유)
  - 완료 시 요약(added/skipped/failed). running이면 시작 버튼 비활성.

---

## 5. 데이터 흐름 / 멱등성

- 영화 backfill: TMDB 인기 페이지 순회 → vm4 `movies` upsert(중복 무시). 이미 있으면 스킵.
- 자막 수집: vm4 movies 중 vm5 종료상태 아닌 영화 → subdl 검색·다운로드(**api_key 포함**, 유료 한도) → vm5 `subtitles` + `processing_status.subtitle_state` upsert. 종료상태(done/skipped/failed≥3) 제외.
- 크론과 수동이 같은 로직·같은 멱등 원장을 공유하므로 겹쳐 돌아도 데이터 정합성 유지(동시성은 타입별 1건으로 제한, 크론 concurrencyPolicy Forbid).

## 6. 엣지/에러 처리

- subdl 다운로드 일일 한도 도달 → `SubdlRateLimit` → 잡 `failed` + error에 사유 표기(매니저 에러 박스). 데이터는 그때까지 저장됨.
- BE 파드 재시작 중 수동 잡 → 표시 상태 유실, 데이터는 DB에 보존, 재클릭으로 이어받기.
- 중복 클릭/동시 요청 → 같은 타입 running이면 기존 잡 상태 반환.

## 7. 테스트

- **BE `tests/test_jobs.py`**(신규): `start`가 백그라운드 태스크 기동·즉시 반환; running 중복 시작 시 같은 잡 반환; progress/done 이벤트→상태·로그 매핑; 예외→failed+error 캡처. (가짜 async gen + asyncio)
- **BE `test_subtitle_collect.py`**(갱신): `run()` CLI가 collect_events를 완주(MockTransport). progress 페이로드 보강분 검증.
- **BE `test_main_*`**: `POST .../backfill?limit=N`이 limit 반영해 잡 시작, `GET /api/jobs/{type}` 상태 반환(jobs 모킹).
- **FE**: 기존 매니저 테스트 패턴이 있으면 폴링 패널 최소 검증, 없으면 수동 확인.

## 8. 배포

- CI(`deploy-4k-be.yml`)가 BE 이미지 빌드 후 `kustomization.yaml`의 `images.newTag`를 sha로 갱신(한 곳). 신규 cronjob은 kustomize resources에 추가만 하면 동일 newTag가 적용됨 — 별도 sed 불필요.
- FE는 기존 CI로 배포.
- 신규 CronJob은 ArgoCD 동기화로 생성.

## 9. 범위 밖

- 크론 실행 이력의 매니저 표시(헤드리스 유지).
- DB 잡 테이블/영속 이력.
- 자막 수집 스트림 타임아웃 인프라 변경(백그라운드 전환으로 불필요).
