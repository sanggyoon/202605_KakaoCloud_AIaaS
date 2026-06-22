# DB 부하 감소 — 라우트 캐싱 + 페이로드 축소 설계

작성일: 2026-06-22
상태: 설계 승인됨

## 목적

부하 테스트(2026-06-22 REPORT)에서 시스템 천장이 **단일 노드 vm4(DB) CPU**로 확인됨
(읽기 핫패스 ~700 동시 사용자에서 vm4 100% 포화). 앱 티어(FE)는 HPA로 잘 확장되나 DB가
자동확장되지 않아 병목. **새 인프라 없이** 대시보드 영화 목록 조회의 DB 부담을 줄인다.

목표:
1. 동일한 첫 페이지 조회가 매번 vm4를 때리지 않도록 **응답 캐싱**.
2. 목록 응답 **페이로드 축소**(불필요 컬럼 제거)로 대역폭·서빙 비용 감소.
3. **필터링/검색은 반드시 서버사이드(vm4 전체 데이터 기준) 유지** — 과거 "렌더된
   데이터만 필터링되던" 회귀를 절대 재발시키지 않는다.

## 배경 / 확정 사실

- FE 대시보드는 **브라우저가 `data.peakly.art`(vm4 PostgREST)로 직접** 영화 목록을 조회
  (`4K_FE/app/dashboard/page.tsx`의 `fetchMovies`, 무한스크롤 offset 페이지네이션).
- 현재 필터링은 **이미 서버사이드**: `fetchMovies`가 연도(`release_year` gte/lte),
  장르(`genre` ilike), 비선호(`tmdb_id` not.in / `genre` not.ilike), 검색
  (`or=(title.ilike,original_title.ilike)`)을 모두 쿼리 파라미터로 vm4에 전달
  (line 106~126). 검색을 서버로 옮긴 것은 커밋 `d7ab92c`에서 수정 완료.
- 목록 카드 `PosterCard`가 쓰는 컬럼: `poster_path, title, original_title, release_year,
  genre, has_vector, tmdb_id, id`. 줄거리·배우 등은 **안 씀**.
- 공개 상세 `DetailOverlay`는 넘겨받은 `movie` props를 그대로 사용 — `overview, actors,
  director, runtime, youtube_key`를 props에서 읽고 **자체 fetch 안 함**.
- 영화 데이터는 **하루 1회** cron(backfill/scoring)으로만 갱신 → 캐시 적중률 매우 높음.
- `data.peakly.art`는 Route53 페일오버(카카오↔AWS DR) 호스트네임.
- 인프라에 CDN(CloudFront/Cloudflare) 없음. Redis 없음(도입 안 함).
- 벡터 모드(선호/비선호)는 `fetchPreferredMovies` RPC 후보 → 클라이언트에서 좁힘
  (고정 후보셋, 페이지네이션 아님). 의도된 동작이며 이번 범위 밖.

## 핵심 개념 (왜 이 설정인가)

- **라우트 캐싱 ≠ Redis ≠ CDN.** Next.js Route Handler 내부 `fetch(..., { next: {
  revalidate } })`의 Data Cache를 사용 — 별도 서버 없이 **FE 파드 안**에 캐시. FE 파드는
  HPA(2→8)로 확장되므로 캐시 서빙도 함께 확장된다.
- **파드별 캐시**라 DB는 "5분 × 파드 수"만큼만 갱신된다(예 8파드 → 5분에 8회). 현재
  수백 req/초 대비 천 분의 일 수준 → DB 천장 해소에 충분. 공유 단일 캐시(=Redis)는
  과하므로 도입하지 않는다(YAGNI).
- **캐시는 URL(쿼리)별로 키가 분리**된다. 필터 조합마다 별도 캐시 엔트리이고, 각 엔트리는
  **vm4가 서버에서 필터링한 결과**다. 즉 캐싱은 "필터 결과의 사본"일 뿐, 필터링 주체는
  여전히 DB. "캐시된 첫 페이지를 클라이언트에서 거르는" 구조가 **아니다**.
- 포스터 이미지는 TMDB CDN(`image.tmdb.org`)에서 직접 서빙 — DB 부하와 무관, 손대지 않음.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 캐싱 위치 | Next.js Route Handler 내장 Data Cache (FE 파드 내, Redis/CDN 미사용) |
| 캐시 TTL | `revalidate: 300`(5분). 하루 1회 갱신 데이터라 충분, 수동 추가도 5분 내 반영 |
| 라우트 성격 | **투명 프록시** — 쿼리스트링을 변형 없이 vm4로 포워딩, apikey만 서버에서 부착 |
| 목록 select | `id,tmdb_id,title,original_title,poster_path,release_year,genre,has_vector` |
| 상세 데이터 | `DetailOverlay`가 열릴 때 `tmdb_id`로 전체 레코드 1건 지연 fetch |
| 필터/검색 | 변경 없음 — 전부 서버사이드 유지(쿼리 파라미터 그대로 전달) |
| 벡터 모드 | 변경 없음(RPC + 클라이언트 좁힘) |
| 매니저 경로 | 변경 없음(`/api/manager/*`) |

## 상세 설계

### Part A — 라우트 캐싱 (`app/api/movies/route.ts`, 신규)

- GET Route Handler. 들어온 쿼리스트링을 **그대로** `${SUPABASE_URL}/rest/v1/movies?<동일
  쿼리스트링>`으로 전달. 헤더에 `apikey`(서버 보관 또는 기존 공개 anon 키) 부착.
- 업스트림 호출을 `fetch(upstreamUrl, { headers: { apikey }, next: { revalidate: 300 } })`
  로 감싸 Data Cache 적용. 응답 JSON 본문을 그대로 반환(`Content-Range` 등 불필요 —
  대시보드는 `arr.length === PAGE_SIZE`로 hasMore 판정).
- 업스트림 실패(비2xx) 시 동일 상태코드/빈 배열로 안전 반환.

### Part B — 대시보드 fetch 전환 + 페이로드 축소 (`dashboard/page.tsx`)

- `fetchMovies`의 base를 `${SUPABASE_URL}/rest/v1/movies` → **`/api/movies`** 로 변경.
  나머지 쿼리 파라미터(limit/offset/order/필터/검색) **구성 로직은 그대로** 둔다.
  브라우저에서 apikey 헤더 부착 제거(라우트가 서버에서 처리).
- `select=*` → `select=id,tmdb_id,title,original_title,poster_path,release_year,genre,has_vector`.
- 필터·정렬·검색·페이지네이션 코드는 **일절 변경하지 않는다**(서버사이드 유지).
- `recentCache` fetch(`tmdb_id=in.(...)`)도 동일 축소 select로 정렬(선택) — 카드만 쓰므로 안전.

### Part C — 상세 지연 로드 (`DetailOverlay.tsx`)

- 열릴 때(`movie.tmdb_id` 변경 시) 전체 레코드 1건을 fetch
  (`overview, actors, director, runtime, youtube_key, imdb_id` 등). 기존 벡터/유사영화
  fetch와 같은 `useEffect` 패턴. 로딩 중에는 props로 받은 축소 필드로 먼저 렌더.
- 사용자가 영화를 클릭할 때만 발생(저빈도) → DB 부담 미미. `/api/movies` 경유 또는 직접
  조회 중 택1(저빈도라 직접 조회도 무방).

### 데이터 흐름

```
[목록] 브라우저 → /api/movies?<필터쿼리> → (Data Cache 적중?) 
        ├ 적중: FE 파드 메모리에서 반환 (vm4 미접촉)
        └ 미적중(5분 경과): vm4 PostgREST가 서버 필터링 → 캐시 저장 → 반환
[상세] 영화 클릭 → DetailOverlay가 tmdb_id로 전체 1건 fetch (저빈도)
[이미지] 포스터 → TMDB CDN (변경 없음)
```

## 검증

- **회귀(최우선)**: 변경 전/후 **동일 필터·검색·정렬 입력에 동일한 결과**가 나오는지 확인.
  연도/장르/비선호/검색 각각 + 조합, 무한스크롤 다음 페이지, 정렬 토글(최신/오래된).
  특히 "로드 안 된 영화도 검색·필터에 잡히는지"(서버사이드 유지) 확인.
- **상세**: 영화 클릭 시 줄거리·배우·감독·러닝타임·트레일러가 정상 표시.
- **캐시 효과**: 첫 페이지 반복 호출 시 vm4 쿼리 로그/CPU가 안 증가하는지. 가능하면
  `loadtest/peakly-stress-read.js` 재실행해 vm4 CPU 천장이 완화됐는지 비교.
- **빌드/타입/lint**: `npx tsc --noEmit`, `npx eslint` 통과.

## 범위 밖 (YAGNI)

- Redis 등 공유 캐시 서버 도입(파드별 캐시로 충분).
- CDN(CloudFront) 도입(새 인프라 + DR DNS 복잡도).
- DB 읽기 replica / PgBouncer 커넥션 풀링(인프라 변경, 후속 과제).
- 벡터 모드/매니저 경로 캐싱.
- 캐시 능동 무효화(수동 영화 추가 시) — 5분 TTL로 충분, 필요 시 후속.
