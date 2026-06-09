# 매니저 페이지 (`/manager`) 설계

**날짜:** 2026-06-09
**상태:** 승인됨

## 배경 / 문제

현재 `/movie_list` 페이지에 매니저 기능이 과도하게 몰려 있다. 헤더 한 줄에
검색 · 페이지네이션 · "신규 100개 추가"(backfill) · 최근 추가 데이터 · 로그아웃이
모두 들어가 있어, 영화 리스트 화면이 운영 도구와 모니터링 도구를 겸하고 있다.

이를 정리하기 위해 새로운 **매니저 허브** 페이지(`/manager`)를 만든다. 허브는
서비스 모니터링 지표를 보여주고, 세부 기능으로 진입하는 출발점이 된다.
`/movie_list`는 순수 영화 리스트 관리 화면으로 단순화한다.

## 목표

- `/manager` 페이지 신규 생성 — 로그인 후 도착하는 매니저 허브.
- 서비스 모니터링: 방문자 통계(누적 / 한 달 / 1주일 / 하루)와
  영화 데이터 통계(전체 / 그래프 있음 / 그래프 없음)를 표시.
- 액션 버튼 3개: ① 영화 정보 리스트(이동) ② 새로운 영화 100개 추가(실행)
  ③ 영화 데이터 스코어링(미구현 placeholder).
- `/movie_list`에서 backfill 기능을 제거하고 `/manager`로 이전.
- 매니저 페이지 접근을 세션 쿠키로 가드(middleware), 로그인 진입점을 `/manager`로 변경.

## 비목표 (YAGNI)

- 영화 데이터 스코어링 실제 동작 — 추후 개발될 모델로 동작 예정. 이번엔 비활성 버튼만.
- 엄밀한 순수 고유 방문자(unique visitor) 집계 — DAU/WAU/MAU 방식 근사로 충분.
- 매니저 API 라우트(`/api/manager/movies/*`)의 서버측 인증 강제 — 이번 범위는
  페이지 미들웨어 가드까지. (기존에도 API 라우트는 쿠키를 검사하지 않음.)
- 방문자 통계 차트/시계열 시각화 — 숫자 카드만.

## 아키텍처

기존 구조를 따른다:

```
공개 사용자 ─▶ Next FE (공개 페이지 /, /dashboard)
                  └─ POST /api/visit ─▶ BE POST /api/visits ─▶ Supabase visits insert (service key)

매니저 ─▶ Next FE (/manager, /movie_list)  ← middleware 세션 가드
            ├─ GET  /api/manager/stats     ─▶ BE GET  /api/stats     ─▶ Supabase count (visits, movies)
            └─ POST /api/manager/movies/backfill ─▶ BE POST /api/movies/backfill (기존, 변경 없음)
```

- 공개 데이터 읽기는 기존처럼 브라우저 → Supabase anon key 직접 호출.
- 쓰기/집계는 BE(service key, `tc.sb_headers()`)를 경유.

## 컴포넌트별 설계

### 1. `/manager` 페이지 — `4K_FE/app/manager/page.tsx` (신규)

클라이언트 컴포넌트. 기존 다크 시네마 톤/토큰(`var(--bg)`, `var(--fg)`,
`var(--accent)`) 및 `MANAGER` 배지 스타일을 재사용.

레이아웃:

```
헤더:  서비스 모니터링  [MANAGER]                              [로그아웃]
──────────────────────────────────────────────────────────────────────
방문자 통계      누적          한 달(30일)    1주일(7일)     하루(오늘)
영화 데이터      전체 N        그래프 있음     그래프 없음
──────────────────────────────────────────────────────────────────────
[ 영화 정보 리스트 → ]   [ 새로운 영화 100개 추가 ]   [ 영화 데이터 스코어링 (준비 중) ]
```

- 마운트 시 `GET /api/manager/stats` 호출 → 카드 채움. 로딩 중 스켈레톤/`—`,
  실패 시 `—` 표시.
- **버튼 1** `영화 정보 리스트`: `router.push('/movie_list')`.
- **버튼 2** `새로운 영화 100개 추가`: 기존 `movie_list`의 backfill 로직
  (`runBackfill`, NDJSON 스트림 소비, 진행 상태 state, 진행 배너 UI)을 그대로 이전.
  완료 후 통계(영화 수)를 다시 fetch해 갱신.
- **버튼 3** `영화 데이터 스코어링`: `disabled`, 보조 문구 "추후 개발된 모델로 동작 예정".
  클릭 동작 없음.
- 로그아웃: 기존과 동일 — `POST /api/manager/auth/logout` 후 `/login`으로.

### 2. 방문자 추적 (신규)

**테이블 (Supabase, `data.peakly.art`)**

```sql
create table if not exists visits (
  id         bigint generated always as identity primary key,
  visitor_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists visits_created_at_idx on visits (created_at);
```

SQL 파일을 `4K_BE/DB_SCRIPTS/`에 추가(예: `visits_schema.sql`). 운영 DB 적용은 수동.

**비콘 — `4K_FE/app/lib/data.ts`에 `logVisit()` 추가**

- localStorage `4k_visitor_id`(없으면 `crypto.randomUUID()` 생성)와
  `4k_last_visit`(YYYY-MM-DD) 사용.
- 오늘 이미 기록했으면 no-op. 아니면 `POST /api/visit { visitor_id }`를
  fire-and-forget으로 보내고 `4k_last_visit`을 오늘로 갱신.
- 공개 페이지에서만 호출: `app/page.tsx`(`/`)와 `app/dashboard/page.tsx`의
  `useEffect` 마운트 시. 매니저 페이지에서는 호출하지 않음.

**지표 정의**

방문 = "브라우저당 하루 1행". 집계는 행 수 기준:
- 하루 = `created_at >= 오늘 00:00`
- 1주일 = 최근 7일
- 한 달 = 최근 30일
- 누적 = 전체 행 수

DAU/WAU/MAU 방식의 근사이며 엄밀한 순수 고유 방문자 수는 아니다(한 브라우저가
여러 날 방문하면 기간 집계에 중복 계수). 모니터링 용도로 충분.

### 3. 통계 API

**BE — `4K_BE/app/main.py`에 엔드포인트 2개 추가**

- `POST /api/visits` — body `{ visitor_id }`. Supabase `visits`에 1행 insert
  (`tc.sb_headers()`, service key). 검증: `visitor_id`가 비어있지 않은 문자열.
  응답 `{ ok: true }`.
- `GET /api/stats` — 반환:
  ```json
  {
    "visitors": { "total": N, "month": N, "week": N, "day": N },
    "movies":   { "total": N, "with_graph": N, "without_graph": N }
  }
  ```
  Supabase count로 집계. 각 count는 PostgREST `Prefer: count=exact`,
  `Range: 0-0`(또는 `limit=1`)로 요청 후 응답 `Content-Range` 헤더의 total을 파싱
  (예: `0-0/1234` → 1234). 기간 필터는 `created_at=gte.<ISO>`.
  - `movies.total` = movies 전체 count
  - `movies.with_graph` = `has_vector=eq.true` count
  - `movies.without_graph` = `total - with_graph` (null·false 포함)
  - 기준 시각(오늘/7일/30일)은 BE에서 UTC로 계산.

**FE 프록시 — `4K_FE/app/api/manager/stats/route.ts` (신규)**

- `GET` → BE `${BE_INTERNAL_URL}/api/stats` 프록시, `cache: 'no-store'`.
  기존 `app/api/manager/movies/route.ts` 패턴을 따름.

**FE 공개 비콘 프록시 — `4K_FE/app/api/visit/route.ts` (신규)**

- `POST` → BE `${BE_INTERNAL_URL}/api/visits` 프록시. 인증 불필요(공개).
  실패해도 조용히 처리.

### 4. `/movie_list` 정리 — `4K_FE/app/movie_list/page.tsx`

- 제거: `backfill` state, `runBackfill` 함수, 헤더의 "신규 100개 추가" 버튼,
  진행 배너 UI, 관련 구분선.
- 유지: 검색, 페이지네이션, 추가/삭제, 최근 추가 데이터 링크, 로그아웃, 상세 모달.
- 헤더 백링크 `← 대시보드`(→ `/dashboard`)를 `← 매니저`(→ `/manager`)로 변경.

### 5. 인증 정리

- **로그인 기본 리다이렉트 변경** — `4K_FE/app/login/page.tsx`에서 `next`가 없을 때
  기본 목적지를 `/movie_list` → `/manager`로 변경.
- **middleware 신규** — `4K_FE/middleware.ts`:
  - `matcher`로 `/manager`, `/movie_list`(및 하위 `/movie_list/...`) 보호.
  - 요청 쿠키의 `manager_session`을 `isValidSession`으로 검증.
    `isValidSession`은 `node:crypto`를 사용하므로 Edge 런타임 충돌 시
    `export const config = { runtime: 'nodejs' }` 또는 동등한 Node 런타임 미들웨어로
    구성. (Next 버전 제약은 `node_modules/next/dist/docs/` 확인 후 적용.)
  - 미인증 시 `/login?next=<원래경로>`로 리다이렉트.

## 데이터 흐름

1. 공개 방문자가 `/` 또는 `/dashboard` 진입 → `logVisit()` → (하루 첫 방문이면)
   `POST /api/visit` → BE → `visits` insert.
2. 매니저가 `/manager` 진입(미들웨어 통과) → `GET /api/manager/stats` →
   BE `GET /api/stats` → Supabase count 집계 → 카드 렌더.
3. 매니저가 "새로운 영화 100개 추가" 클릭 → 기존 backfill 스트림 → 완료 후 stats 재조회.

## 에러 처리

- `logVisit`/`/api/visit`: fire-and-forget, 실패 무시(사용자 영향 없음).
- `/api/manager/stats` 실패 또는 일부 count 실패: 해당 카드 `—` 표시, 페이지는 정상.
- BE count의 `Content-Range` 파싱 실패: 해당 항목 0 또는 null 처리, 500 던지지 않음.
- 미들웨어: 쿠키 검증 실패 → `/login?next=`로 리다이렉트(예외 없이).

## 테스트

- **BE (pytest, 기존 `4K_BE/tests/` 패턴 — httpx 모킹):**
  - `POST /api/visits` — 정상 insert 호출, `visitor_id` 누락 시 400.
  - `GET /api/stats` — `Content-Range` 헤더 파싱으로 visitors/movies 집계가
    올바른 형태로 반환되는지(모킹된 count 값 기반), `without_graph = total - with_graph`.
- **FE:** 자동 테스트 셋업 없음 → 수동 검증
  (공개 페이지 진입 후 visits 1행 기록, `/manager` 카드 표시, backfill 동작,
  미인증 시 `/login` 리다이렉트).

## 미해결 / 후속

- 영화 데이터 스코어링: 추후 ML 모델 연동 시 버튼 활성화 + 엔드포인트 추가.
- 순수 고유 방문자 집계가 필요해지면 `visitor_id` distinct count용 RPC 추가 고려.
