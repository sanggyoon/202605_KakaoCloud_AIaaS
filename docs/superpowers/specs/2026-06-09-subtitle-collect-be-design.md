# 자막 수집을 4K_BE로 이동 + 매니저 버튼 설계

**날짜:** 2026-06-09
**상태:** 승인됨
**상위 맥락:** ML 파이프라인 step 2(자막 수집). 하위 프로젝트 B에서 `4K_ML/subtitle_fetch/` CLI로 구현·검증했으나, 자막 수집은 메타데이터 backfill과 같은 "외부 API → DB 적재" 데이터 수집이므로 **4K_BE로 이동**하고 매니저 페이지 버튼으로 트리거한다. 4K_ML은 step 3~7(파싱·라벨링·학습·서빙·임베딩) ML 전용으로 남는다.

## 배경 / 문제

vm4 메타데이터 backfill은 4K_BE에 있고 매니저 버튼 + CronJob이 `backfill_events` 제너레이터를 공유한다. 자막 수집도 동일한 성격(외부 fetch→DB)이라 같은 패턴으로 4K_BE에 두면, 매니저 페이지에서 vm4 backfill과 똑같은 UX(버튼 + 실시간 진행 바)로 동작한다. 진행 표시는 NDJSON 스트리밍으로 해결되어 "마냥 기다리는" 문제도 사라진다.

## 목표

- subdl 자막 수집을 4K_BE로 이식(`subtitle_collect.py`), `backfill_popular.py`와 동일한 제너레이터+스트리밍 패턴.
- 매니저 페이지 **"자막 데이터 수집"** 버튼 → 자막이 없는 영화를 **최대 100편(기본값) 수집 시도**, 진행 바 실시간 표시.
- `4K_ML/subtitle_fetch/` 제거(이동). `4K_ML/db/`(스키마)는 유지.

## 비목표 (YAGNI)

- **CronJob/전체 크롤링** — `collect_events` 제너레이터는 재사용 가능하게 두되, CronJob 진입점·전체 크롤링은 이번 범위 밖(나중에).
- 자막 파싱·씬 분리 등 ML 단계 — 4K_ML(step 3~7).
- 다국어 — 영어 단일.

## 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 코드 위치 | 4K_BE (`app/subtitle_collect.py`), backfill과 동일 패턴 |
| 트리거 | 매니저 버튼 → BE 스트리밍 엔드포인트 (Cron은 나중) |
| 1회 수집량 | 자막 없는 영화 **최대 100편 시도** (`SUBTITLE_MAX_NEW`, env 조정) |
| "없는" 기준 | vm5 `processing_status.subtitle_state != 'done'` |
| 선택 규칙 | 영어·단편(full_season 아님) 필터 + SDH(hi) 우선 + subdl 반환순 1등 (4K_ML B에서 검증) |
| srt 보장 | zip 추출 단계(가장 큰 .srt). subdl 검색은 format 미제공 |
| 상태 의미 | 없음=`skipped`, 오류=`failed`, ratelimit=우아한 중단 |
| 4K_ML/subtitle_fetch | 제거(이동) |

## 아키텍처 (backfill 미러링)

```
매니저 페이지 "자막 데이터 수집" 버튼
  → FE POST /api/manager/subtitles/collect (스트리밍 프록시)
  → BE POST /api/subtitles/collect  (StreamingResponse, NDJSON)
       └ subtitle_collect.collect_events() 소비 → 각 줄이 progress/done 이벤트
            ├ vm4 movies 읽기 (기존 tc 헬퍼/REST)
            ├ vm5 done id 집합 1회 조회 → 안 된 영화만 대상
            ├ subdl 검색→choose→zip 다운로드→.srt 추출
            └ vm5 subtitles upsert + processing_status 갱신
```

## 컴포넌트

### `4K_BE/app/subtitle_collect.py` (신규)
- **subdl 클라이언트(async)**: `search(client, tmdb_id) -> list[dict]`, `download_and_extract(client, url) -> str`(zip→가장 큰 .srt, utf-8/latin-1), `SubdlRateLimit`.
- **선택**: `choose(candidates) -> dict | None` (영어·단편 필터 + SDH 우선 + 반환순). 보조 `is_sdh`/`_is_english`/`_is_full_season`.
- **vm5 REST 입출력**: `get_done_ids(client) -> set[int]`, `save_subtitle(client, tmdb_id, chosen, raw_text)`, `set_status(client, tmdb_id, state, error=None)`. ai env + apikey 헤더(basic auth 없음).
- **`collect_events(client, max_new, rate_delay) -> AsyncIterator[dict]`**: vm4 movies 순회, done 제외, 자막 없는 영화를 최대 `max_new`편 처리하며 이벤트 yield.
  - `{"type":"progress","processed":int,"target":int,"title":str|None}`
  - `{"type":"done","added":int,"skipped":int,"failed":list[int]}`
  - `processed` = 시도한(자막 없던) 영화 누적, `max_new` 도달 시 종료. `SubdlRateLimit` 시 done 이벤트로 마무리.
- **`config_from_env() -> tuple[int,float]`**: `SUBTITLE_MAX_NEW`(기본 100), `SUBTITLE_RATE_DELAY`(기본 0.5).

### `4K_BE/app/main.py` (수정)
- `POST /api/subtitles/collect` → `StreamingResponse(media_type="application/x-ndjson")`, `collect_events` 소비(`/api/movies/backfill` 미러).

### `4K_BE/app/tmdb_common.py` (수정 또는 subtitle_collect 내 헬퍼)
- vm5(ai) 접근 헬퍼: `ai_url()`, `ai_headers()`(apikey/Authorization Bearer), 선택 basic auth. vm4 헬퍼와 분리.

### FE
- `4K_FE/app/api/manager/subtitles/collect/route.ts` (신규) — `/api/manager/movies/backfill/route.ts` 미러(스트리밍 프록시).
- `4K_FE/app/manager/page.tsx` (수정) — "자막 데이터 수집" 버튼 + 진행 배너. 기존 backfill 상태/스트림 소비 로직을 일반화하거나 두 번째 세트로 추가.

### 제거
- `4K_ML/subtitle_fetch/`(소스+테스트) 삭제. `4K_ML/db/`·`generate_vectors/`는 유지. `4K_ML/requirements.txt`의 psycopg는 `db/apply_schema.py`가 쓰므로 유지.

## 데이터 흐름 (영화 1편당, collect_events 내부)

1. `get_done_ids`로 vm5의 `subtitle_state='done'` tmdb_id 집합 확보(1회).
2. vm4 movies 순회 → done 집합에 있으면 skip(카운트 안 함).
3. 안 된 영화: subdl 검색 → `choose` → None이면 `set_status('skipped')`, `processed++`.
4. 후보 있으면 zip 다운로드 → .srt 추출 → 비어있지 않으면 `save_subtitle` + `set_status('done')`, else `failed`. `processed++`.
5. `progress` 이벤트 yield, `rate_delay` 대기. `processed >= max_new`면 종료 → `done` 이벤트.
6. 도중 `SubdlRateLimit` → 루프 중단 → `done` 이벤트(여기까지 집계).

## 에러 처리 / 한도

- 자막 없음 → `skipped`(재시도 안 함, processed에는 포함 — "시도 100편" 기준).
- subdl/네트워크/zip 오류 → `failed` + error, `retry_count++`.
- rate limit → 즉시 정상 종료, 처리 중이던 영화는 pending.
- 멱등: subtitles upsert(on conflict tmdb_id), done 영화 skip.
- 스트리밍 끊김(클라이언트 닫힘) → 서버 제너레이터 취소, 이미 적재된 것은 유지.

## 환경변수 (4K_BE)

신규: `SUBDL_API_KEY`, `AI_DATABASE_URL`, `AI_DATABASE_KEY`, 선택 `AI_BASIC_USER`/`AI_BASIC_PASS`. 기존 vm4 메타데이터용 env는 그대로. (배포 매니페스트/시크릿에도 추가 필요 — 운영 핸드오프.)

## 테스트 (4K_BE pytest, 기존 MockTransport 패턴)

- `choose()`: SDH 우선, 영어 필터, 폴백, 후보 없음 → None.
- `download_and_extract`/`_largest_srt`: 메모리 zip(여러 .srt) → 가장 큰 것, srt 없음 → 오류.
- `search`: MockTransport로 `subtitles[]` 파싱, 429 → `SubdlRateLimit`.
- `collect_events`: vm4/vm5/subdl 모킹 → done/skipped/failed 전이, `max_new` 상한에서 종료, done 집합 영화 skip.

## 미해결 / 후속

- CronJob/전체 크롤링(`run_collect` + manifest) — 나중.
- BE 배포 시 vm5 env/시크릿 주입 — 운영 핸드오프.
- 매니저 페이지에서 backfill·자막 두 진행 배너 공통화 여부(중복되면 컴포넌트로 추출).
