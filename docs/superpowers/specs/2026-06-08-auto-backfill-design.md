# 자동 영화 Backfill + 최근 추가 데이터 보기 — 설계

- 작성일: 2026-06-08
- 대상: `4K_BE`(FastAPI / DB_SCRIPTS), `4K_FE`(매니저 페이지), `Ansible/manifests/4k-be`(K8s)

## 1. 목적

서비스 DB(`service.movies`)에 없는 영화를 매니저의 수동 클릭 없이 **자동으로 채운다**. 후보는 TMDB 인기작이며, 한 번 실행에 신규 일정 개수만 채우고 주기적으로 반복한다. 또한 매니저가 **최근 채워진 데이터만 따로 확인**할 수 있는 화면을 추가한다.

## 2. 확정된 결정 사항

- **후보 모집단**: TMDB `discover/movie`, `sort_by=popularity.desc` (인기순).
- **수집 전략**: 인기순으로 페이지를 순회하며 DB에 없는 영화만 추가. **실행당 신규 추가 수가 100개(`BACKFILL_MAX_NEW`)에 도달하면 중지.**
- **실행 방식**: K8s **CronJob** (ArgoCD GitOps + Kustomize 패턴과 일치, BE 이미지 재사용, 1회성 Job Pod).
- **주기**: 매일 1회 03:00 KST (`schedule`로 조절 가능, 기본값).
- **범위**: `movies` **메타데이터만** 채운다. `movie_vectors`(클라이맥스 벡터)는 생성하지 않는다.
- **최근 추가 데이터 보기**: 매니저 페이지에 `created_at` 내림차순 목록 화면 추가. 스키마 변경 없음(컬럼 이미 존재).

## 3. 아키텍처

```
[CronJob: movie-backfill]  매일 03:00 KST, BE 이미지, command=python -m DB_SCRIPTS.backfill_popular
        │
        ▼
[backfill_popular.py]
   1) Supabase movies 전체 tmdb_id 1회 조회 → existing set
   2) TMDB discover(popularity.desc) 페이지 순회
   3) existing에 없는 id만 detail fetch → movie dict
   4) 50개 배치 upsert (ignore-duplicates)
   5) 누적 신규 ≥ BACKFILL_MAX_NEW(100) → 중지
        ▼
[Data Supabase movies]  ── created_at DEFAULT NOW()
        ▲
        │ GET /api/movies/recent?limit=N  (order=created_at.desc)
[FastAPI BE]
        ▲
        │ /api/manager/movies/recent (FE 프록시, proxy.ts 인증 보호)
[FE 매니저 페이지 /movie_list/recent]  "최근 추가 데이터" 화면
```

## 4. 컴포넌트

### 4.1 공통 모듈 추출 — `4K_BE/DB_SCRIPTS/tmdb_common.py` (신규)

`seed_movies.py`와 `backfill_popular.py`가 공유하는 순수/IO 함수를 한곳으로 모아 중복 제거:

- `pick_trailer(videos) -> str | None`
- `build_movie(tmdb_detail, tmdb_id) -> dict` (TMDB 상세 → movies row dict)
- `fetch_movie(client, tmdb_id) -> dict | None`
- `get_existing_tmdb_ids(client) -> set[int]`
- `upsert_movies(client, rows, resolution) -> bool` (`resolution`로 merge/ignore 선택)

`seed_movies.py`는 이 모듈을 import하도록 리팩터링(동작 동일, 하드코딩 ID 리스트 유지). `main.py`의 `add_movie`도 `build_movie`를 재사용하도록 정리(선택).

### 4.2 Backfill 스크립트 — `4K_BE/DB_SCRIPTS/backfill_popular.py` (신규)

환경변수:

| 변수 | 기본값 | 의미 |
|---|---|---|
| `BACKFILL_MAX_NEW` | `100` | 실행당 신규 추가 한도(도달 시 중지) |
| `BACKFILL_MAX_PAGES` | `100` | 안전 상한(무한 루프 방지) |
| `BACKFILL_RATE_DELAY` | `0.26` | TMDB 요청 간 대기(초) |

핵심 루프(의사 코드):

```python
existing = get_existing_tmdb_ids(client)
added, batch, page = 0, [], 1
while added < MAX_NEW and page <= MAX_PAGES:
    results = tmdb_discover(client, sort_by="popularity.desc", page=page)
    if not results:
        break
    for m in results:
        if m["id"] in existing:
            continue                         # 이미 있음 → detail 호출 안 함
        movie = fetch_movie(client, m["id"])
        if movie:
            batch.append(movie); existing.add(m["id"]); added += 1
            if len(batch) >= 50:
                upsert_movies(client, batch, resolution="ignore-duplicates"); batch.clear()
        if added >= MAX_NEW:
            break
        time.sleep(RATE_DELAY)
    page += 1
if batch:
    upsert_movies(client, batch, resolution="ignore-duplicates")
log(f"backfill 완료: 신규 {added}개, 마지막 page {page}")
```

종료 로그는 `신규 N개 / 마지막 page / 실패 [...]` 형태 → Loki로 수집.

### 4.3 CronJob 매니페스트 — `Ansible/manifests/4k-be/backfill-cronjob.yaml` (신규)

- 기존 BE Deployment와 **동일 이미지·동일 Secret/env** 사용(TMDB_API_KEY, DATA_SUPABASE_URL/KEY, DATA_BASIC_USER/PASS).
- `schedule: "0 18 * * *"` (UTC 18:00 = KST 03:00).
- `concurrencyPolicy: Forbid` (이전 실행 미완료 시 중복 방지).
- `restartPolicy: OnFailure`, `backoffLimit: 2`, `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 3`.
- `command: ["python", "-m", "DB_SCRIPTS.backfill_popular"]`.
- `Ansible/manifests/4k-be/kustomization.yaml`의 `resources`에 등록.

### 4.4 BE 최근 추가 엔드포인트 — `4K_BE/app/main.py` (추가)

```python
@app.get("/api/movies/recent")
async def recent_movies(limit: int = 50):
    limit = max(1, min(limit, 200))
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.get(
            f"{DATA_URL}/rest/v1/movies",
            params={
                "select": "tmdb_id,title,poster_path,release_year,has_vector,created_at",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            headers=_sb_headers(),
        )
        if r.status_code != 200:
            raise HTTPException(502, f"Supabase 조회 실패: {r.text[:200]}")
        return {"movies": r.json()}
```

### 4.5 FE 프록시 — `4K_FE/app/api/manager/movies/recent/route.ts` (신규)

`GET` → `${BE_URL}/api/movies/recent?limit=...` 전달. (proxy.ts가 `/api/manager/movies/:path*`를 이미 인증 보호.)

### 4.6 FE 화면 — `4K_FE/app/movie_list/recent/page.tsx` (신규)

- "최근 추가 데이터" 목록: `created_at` 내림차순. 컬럼/카드에 제목, 포스터, 개봉연도, `created_at`, `has_vector` 배지(벡터 유무 → 추천 가능 여부 표시).
- `/movie_list`(관리 화면)과 상호 이동 링크. proxy.ts가 `/movie_list/:path*`를 이미 보호하므로 별도 인증 작업 불필요.
- 기존 `movie_list/page.tsx` 스타일/`posterUrl`/`MovieDetailModal` 재사용.

## 5. 데이터 흐름 / 멱등성

- backfill은 `existing` 집합으로 **이미 있는 영화는 TMDB detail 호출조차 하지 않음** → 호출/처리량 최소화.
- upsert는 `ignore-duplicates`라 기존 행(매니저가 편집했을 수 있음)을 **절대 덮어쓰지 않음**.
- 두 번 연속 실행해도 신규 추가 0이 정상(멱등).
- "최근 추가"는 `created_at`만 보므로 backfill/수동 추가 모두 자연히 반영. backfill은 한 run의 행들이 ~동일 시각이라 "마지막 run 결과"가 상단에 묶여 보인다.

## 6. 에러 처리 / 운영

- 개별 영화 fetch 실패(404 등): 스킵·로깅 후 계속.
- TMDB rate limit: 요청 간 `BACKFILL_RATE_DELAY` 대기.
- CronJob 실패: `OnFailure` 재시도 + `backoffLimit`. 중복 실행은 `Forbid`로 차단.
- 관측: 스크립트 stdout → Promtail/Loki → Grafana.

## 7. 범위 밖 (명시)

- **`movie_vectors` 자동 생성 안 함.** 자동 추가 영화는 메타데이터만 있어 카탈로그/검색엔 노출되나 클라이맥스 추천에는 안 뜸(`has_vector=false`). 벡터는 외부 training 데이터 기반 별도 ML 파이프라인 소관.
- backfill 실행 이력 전용 테이블/대시보드는 만들지 않음("최근 추가"는 `created_at` 정렬로 갈음).
- 매니저 수동 추가/삭제/편집 UI는 변경 없음(최근 보기 화면만 신규).

## 8. 테스트

- `tmdb_common.build_movie` / `pick_trailer`: 순수 함수 단위 테스트(샘플 TMDB 응답 → 기대 dict).
- `backfill_popular`: `BACKFILL_MAX_NEW=2`로 로컬 dry-run → 멱등성(재실행 시 신규 0) 확인.
- `GET /api/movies/recent`: limit 경계(1, 초과 시 200 클램프) 확인.
- FE: 최근 페이지가 빈 목록/정상 목록을 렌더하고 `has_vector` 배지가 맞게 표시되는지.

## 9. 변경/신규 파일 요약

| 종류 | 경로 |
|---|---|
| 신규 | `4K_BE/DB_SCRIPTS/tmdb_common.py` |
| 신규 | `4K_BE/DB_SCRIPTS/backfill_popular.py` |
| 수정 | `4K_BE/DB_SCRIPTS/seed_movies.py` (공통 모듈 사용) |
| 수정 | `4K_BE/app/main.py` (`/api/movies/recent` 추가, build_movie 재사용) |
| 신규 | `Ansible/manifests/4k-be/backfill-cronjob.yaml` |
| 수정 | `Ansible/manifests/4k-be/kustomization.yaml` (resources 등록) |
| 신규 | `4K_FE/app/api/manager/movies/recent/route.ts` |
| 신규 | `4K_FE/app/movie_list/recent/page.tsx` |
