# API 문서 (Peakly)

API는 **3개 표면**으로 나뉜다.

```mermaid
flowchart LR
  subgraph 외부["외부/공개"]
    B[브라우저] -->|anon| SUPA[(Supabase data\n/rest/v1)]
    B -->|"GET /api/movies (캐시)"| FEAPI
    CUST[외부 고객 서버] -->|"X-API-Key"| SCORES["GET /api/movies/:id/scores"]
  end
  subgraph FE["Next.js (4K_FE) — route handlers / BFF"]
    FEAPI[/api/*]
    SCORES
    MGR[/api/manager/* · 세션 인증]
  end
  subgraph BE["FastAPI (4K_BE)"]
    BEAPI[/api/*]
  end
  MGR -->|BE_INTERNAL_URL| BEAPI
  FEAPI --> SUPA
  SCORES --> AIDB[(Supabase ai\nscene_scores)]
  BEAPI --> SUPA
  BEAPI --> AIDB
```

- **공개 API** — 인증 없음 또는 API 키. 브라우저/외부 소비자용.
- **매니저 API** (`/api/manager/*`) — 세션 쿠키 인증(`proxy.ts` 게이트). 대부분 FastAPI로 프록시.
- **FastAPI(BE)** — 클러스터 내부 엔드포인트. FE 매니저 라우트가 `BE_INTERNAL_URL`로 호출.

---

## 1. 공개 API

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/api/movies` | 없음 | 영화 목록(프록시 + Data Cache `revalidate 3600`). 쿼리(`select/limit/offset/order/filter`)를 data Supabase로 전달 |
| GET | `/api/movies/{tmdb_id}/scores` | **X-API-Key** | 외부 점수 API — 장면 감정 타임라인(`scene_scores`) 반환 |
| POST | `/api/visit` | 없음(rate limit) | 방문 비콘 기록(IP당 분당 30 제한) |

### 외부 점수 API 상세 (`GET /api/movies/{tmdb_id}/scores`)
서버→서버 소비자용. CORS 헤더 없음.

- **인증**: 헤더 `X-API-Key` → `api_keys`(해시) 대조(`isValidApiKey`). 유효·활성 키만 통과.
- **검증**: `tmdb_id`는 양의 정수.
- **응답 코드**

| 코드 | 의미 |
|---|---|
| 200 | `scene_scores` 타임라인 데이터 |
| 400 | invalid tmdb_id |
| 401 | unauthorized (키 없음/무효) |
| 404 | movie not found |
| 502 | upstream error (ai DB 오류) |

---

## 2. 매니저 API (`/api/manager/*`, 세션 인증)

`proxy.ts` 미들웨어가 `manager_session` 쿠키 검증 → 없으면 401(JSON) 또는 `/login` 리다이렉트.
`auth/*`만 예외(비인증 허용).

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/manager/auth/login` | ID/비밀번호 인증 → 세션 쿠키. **agami CAPTCHA 결과 동봉(비차단)** |
| POST | `/api/manager/auth/logout` | 세션 종료 |
| GET | `/api/manager/active-model` | 활성 모델 버전·지표 |
| GET·POST | `/api/manager/api-keys` | API 키 목록 / 발급 |
| DELETE | `/api/manager/api-keys/{id}` | API 키 폐기 |
| GET·POST | `/api/manager/movies` | 영화 목록 / 추가 |
| GET | `/api/manager/movies/search` | 영화 검색(TMDB) |
| GET | `/api/manager/movies/recent` | 최근 처리 영화 |
| POST | `/api/manager/movies/backfill` | 인기작 일괄 적재 |
| GET·PATCH·DELETE | `/api/manager/movies/{tmdb_id}` | 단건 조회/수정/삭제 |
| POST | `/api/manager/movies/{tmdb_id}/reprocess` | 파이프라인 재처리 트리거 |
| GET | `/api/manager/subtitles/remaining` | 자막 미수집 잔량 |
| POST | `/api/manager/subtitles/collect` | 자막 수집 작업 트리거 |
| GET | `/api/manager/jobs/{type}` | 작업 상태 조회 |
| GET | `/api/manager/stats` | 대시보드 통계 |
| GET | `/api/manager/visits/range` | 기간별 방문 통계 |

---

## 3. FastAPI (BE) 엔드포인트 — 내부

`4K_BE/app/main.py`. FE 매니저 라우트가 프록시. (data=`DATA_SUPABASE_URL`, ai=`AI_DATABASE_URL`)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 헬스체크 |
| GET | `/api/movies` · `/api/movies/search` · `/api/movies/recent` | 영화 조회/검색 |
| POST | `/api/movies/backfill` | 인기작 backfill |
| GET·PATCH·POST·DELETE | `/api/movies/{tmdb_id}` (+`/detail`, `/reprocess`) | 단건 CRUD·상세·재처리 |
| POST | `/api/subtitles/collect` · GET `/api/subtitles/remaining` | 자막 수집/잔량 |
| GET | `/api/jobs/{job_type}` | 작업 상태 |
| GET | `/api/active-model` | 활성 모델 버전 |
| POST | `/api/visits` · GET `/api/visits/range` | 방문 기록/통계 |
| GET | `/api/stats` | 통계 집계 |
| POST·GET | `/api/api-keys` · DELETE `/api/api-keys/{key_id}` | API 키 관리 |

---

## 인증 정리

| 대상 | 방식 | 구현 |
|---|---|---|
| 외부 점수 API | `X-API-Key` (해시 대조) | `app/lib/apiKeys.ts` + `api_keys` 테이블 / `validate_api_key` RPC |
| 매니저 | 세션 쿠키(HMAC 서명·만료) | `app/lib/auth.ts` + `proxy.ts` (+ agami CAPTCHA, 비차단) |
| 공개 읽기 | anon 키 + **RLS** | `docs/db_script/rls_policies.sql` |
| 서버→ai DB | service 키(서버 전용) | `app/lib/aiDb.ts` |
