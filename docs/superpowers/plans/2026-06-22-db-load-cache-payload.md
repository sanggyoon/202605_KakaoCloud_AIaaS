# DB 부하 감소(라우트 캐싱 + 페이로드 축소) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 영화 목록 조회를 Next.js 라우트 캐싱(1시간) 뒤로 옮기고 응답 페이로드를 축소해 vm4(DB) 부하를 줄인다. 필터링/검색은 서버사이드로 그대로 유지한다.

**Architecture:** 브라우저가 vm4(`data.peakly.art`)를 직접 치던 목록 조회를 FE의 `/api/movies` Route Handler 경유로 바꾼다. 라우트는 쿼리스트링을 변형 없이 vm4로 포워딩하되 `fetch(..., { next: { revalidate: 3600 } })`로 감싸 Data Cache(FE 파드 내)를 적용한다. 목록 select는 카드에 필요한 컬럼만으로 줄이고, 상세창(DetailOverlay)은 열릴 때 전체 레코드 1건을 직접 조회한다.

**Tech Stack:** Next.js 16.2.5 (App Router, Route Handlers, Data Cache), TypeScript, Supabase PostgREST.

## Global Constraints

- **필터링/검색은 반드시 서버사이드 유지.** `fetchMovies`의 쿼리 파라미터 구성(연도 gte/lte, genre ilike, tmdb_id not.in, genre not.ilike, search `or=(title.ilike,original_title.ilike)`)을 변경하지 않는다. 라우트는 쿼리스트링을 1바이트도 바꾸지 않고 그대로 포워딩한다. "로드된 데이터만 거르는" 클라이언트 필터링을 도입하지 않는다.
- 캐시 TTL = `revalidate: 3600`(1시간). 영화는 하루 1회 cron 갱신.
- 목록 select 컬럼(정확히): `id,tmdb_id,title,original_title,poster_path,release_year,genre,has_vector`.
- 새 인프라 금지: Redis/CDN 도입하지 않음. Next.js 내장 캐시만 사용.
- 벡터 모드(선호/비선호 RPC)와 매니저 경로(`/api/manager/*`)는 손대지 않는다.
- 테스트 프레임워크 없음 → 검증은 `npx tsc --noEmit`, `npx eslint <file>`, dev 서버 + curl, 수동 UI 회귀 체크로 한다. 모든 명령은 `4K_FE/`에서 실행.

---

## Task 1: `/api/movies` 캐시 프록시 라우트 생성

**Files:**
- Create: `4K_FE/app/api/movies/route.ts`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY` from `@/app/lib/data`.
- Produces: `GET /api/movies?<querystring>` — 쿼리스트링을 `${SUPABASE_URL}/rest/v1/movies`로 그대로 포워딩하고 JSON 배열을 반환. 1시간 Data Cache.

- [ ] **Step 1: 라우트 핸들러 작성**

`4K_FE/app/api/movies/route.ts`:

```ts
// 대시보드 영화 목록 조회 캐시 프록시.
// 들어온 쿼리스트링을 변형 없이 vm4(PostgREST)로 포워딩 → 필터링은 서버(DB)가 그대로 수행.
// fetch를 revalidate 3600으로 감싸 FE 파드 내 Data Cache 적용(영화는 하루 1회 갱신).
import { NextRequest, NextResponse } from 'next/server';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/app/lib/data';

export async function GET(req: NextRequest) {
  // req.nextUrl.search = "?select=...&limit=120&release_year=gte.2000&..." (인코딩 보존)
  const upstream = `${SUPABASE_URL}/rest/v1/movies${req.nextUrl.search}`;
  try {
    const res = await fetch(upstream, {
      headers: { apikey: SUPABASE_ANON_KEY },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
```

- [ ] **Step 2: 타입/린트 검증**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/api/movies/route.ts`
Expected: 에러 없음(exit 0).

- [ ] **Step 3: dev 서버로 기능 검증 (기본 + 필터 포워딩)**

Run:
```bash
cd 4K_FE && npm run dev   # 별도 터미널에서 실행해 둠 (http://localhost:3000)
# 기본: 2건 JSON 배열
curl -s 'http://localhost:3000/api/movies?select=id,title&limit=2'
# 필터 포워딩 확인(서버사이드): 장르 필터가 적용된 결과만 와야 함
curl -s 'http://localhost:3000/api/movies?select=id,title,genre&genre=ilike.*Drama*&limit=3'
```
Expected: 첫 호출은 영화 2건의 JSON 배열. 둘째 호출은 genre에 Drama 포함 영화만. (둘 다 200, 배열)

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/api/movies/route.ts
git commit -m "feat(fe): 영화 목록 캐시 프록시 라우트(/api/movies, revalidate 1h)"
```

---

## Task 2: DetailOverlay 상세 전체 레코드 지연 로드

**Files:**
- Modify: `4K_FE/app/components/DetailOverlay.tsx`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `Movie` from `@/app/lib/data` (이미 일부 import 됨 — 누락분만 추가).
- Produces: 상세창이 props `movie`(축소 필드일 수 있음)로 먼저 렌더하고, `tmdb_id`로 전체 레코드를 조회해 `overview/actors/director/runtime/youtube_key`를 채운다.

이 작업을 Task 3보다 먼저 한다 — 목록이 아직 전체 컬럼인 상태에서 추가해도(중복 조회) 무해하고, 이후 Task 3에서 컬럼을 줄여도 상세가 깨지지 않게 된다.

- [ ] **Step 1: import 확인/보강**

`4K_FE/app/components/DetailOverlay.tsx` 상단 import에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`가 없으면 `@/app/lib/data` import 목록에 추가한다. `useState`는 이미 import 되어 있음(확인됨).

- [ ] **Step 2: `full` 상태 + 지연 조회 effect 추가**

컴포넌트 본문 시작부(`const genres = genreList(movie.genre);` 바로 위)에 추가:

```tsx
  // props movie는 목록에서 온 축소 레코드일 수 있다. 상세에 필요한 전체 컬럼
  // (overview/actors/director/runtime/youtube_key)을 tmdb_id로 직접 1건 조회해 채운다.
  const [full, setFull] = useState<Movie>(movie);
  useEffect(() => {
    setFull(movie); // 우선 props로 즉시 렌더
    let cancelled = false;
    fetch(
      `${SUPABASE_URL}/rest/v1/movies?tmdb_id=eq.${movie.tmdb_id}&select=*&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY } },
    )
      .then((r) => r.json())
      .then((rows: Movie[]) => {
        if (!cancelled && Array.isArray(rows) && rows[0]) setFull(rows[0]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [movie]);
```

- [ ] **Step 3: 지연 필드 참조를 `movie.` → `full.` 로 교체**

다음 위치의 참조만 교체한다(나머지 `movie.*`는 그대로 둔다):

- `const cast = castList(movie.actors);` → `const cast = castList(full.actors);`
- `{movie.runtime ? ` · ${movie.runtime}MIN` : ''}` → `{full.runtime ? ` · ${full.runtime}MIN` : ''}`
- `{movie.overview && (` → `{full.overview && (`
- 그 블록 내부 `{movie.overview}` → `{full.overview}`
- `{movie.director && (` → `{full.director && (`
- 그 블록 내부 `{movie.director}` → `{full.director}`
- `{movie.youtube_key ? (` → `{full.youtube_key ? (`
- 그 블록 내부 `src={`https://www.youtube.com/embed/${movie.youtube_key}`}` → `${full.youtube_key}`

> `original_title`(title 근처)은 축소 select에 유지되므로 교체 불필요. `genres`(movie.genre)도 유지 컬럼이라 교체 불필요.

- [ ] **Step 4: 타입/린트 검증**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/components/DetailOverlay.tsx`
Expected: 에러 없음.

- [ ] **Step 5: 수동 확인 (목록 아직 전체 컬럼 — 회귀 없어야)**

dev 서버에서 대시보드 영화 클릭 → 상세창에 줄거리·배우·감독·러닝타임·트레일러가 정상 표시되는지 확인(기존과 동일하게 보여야 함).

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/components/DetailOverlay.tsx
git commit -m "feat(fe): 상세창 전체 레코드 지연 로드(목록 페이로드 축소 대비)"
```

---

## Task 3: 대시보드 목록 조회를 `/api/movies` 경유 + select 축소

**Files:**
- Modify: `4K_FE/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/movies`(Task 1).
- Produces: `fetchMovies`와 `recentCache`가 `/api/movies`(목록) / 축소 select를 사용. 필터/검색/정렬/페이지네이션 로직은 불변.

- [ ] **Step 1: 공용 select 상수 추가**

`PAGE_SIZE` 상수 정의 부근(파일 상단 상수 블록)에 추가:

```ts
// 목록 카드에 필요한 컬럼만 — overview/actors 등 무거운 필드 제외(상세에서 지연 로드)
const LIST_SELECT = 'id,tmdb_id,title,original_title,poster_path,release_year,genre,has_vector';
```

- [ ] **Step 2: `fetchMovies`의 base를 `/api/movies`로, select를 축소로 변경**

`fetchMovies` 내 URL 구성 라인(현재):

```ts
    let url = `${SUPABASE_URL}/rest/v1/movies?select=*&limit=${PAGE_SIZE}&offset=${offset}&order=has_vector.desc,release_year.${dir},id.${dir}`;
```

을 다음으로 교체(필터/검색 추가 로직은 이후 줄 그대로 유지):

```ts
    let url = `/api/movies?select=${LIST_SELECT}&limit=${PAGE_SIZE}&offset=${offset}&order=has_vector.desc,release_year.${dir},id.${dir}`;
```

- [ ] **Step 3: 목록 fetch의 apikey 헤더 제거(라우트가 서버에서 부착)**

`fetchMovies` 내 fetch 호출(현재):

```ts
    fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } })
```

을 다음으로 교체:

```ts
    fetch(url)
```

- [ ] **Step 4: `recentCache` 조회 select 축소(히스토리도 카드만 사용)**

`recentCache` effect 내 URL(현재):

```ts
    const url = `${SUPABASE_URL}/rest/v1/movies?select=*&tmdb_id=in.(${missing.join(',')})`;
```

을 다음으로 교체(이 조회는 id 직접 lookup이라 필터링 무관 → 그대로 vm4 직접 조회, select만 축소):

```ts
    const url = `${SUPABASE_URL}/rest/v1/movies?select=${LIST_SELECT}&tmdb_id=in.(${missing.join(',')})`;
```

- [ ] **Step 5: 타입/린트 검증**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/dashboard/page.tsx`
Expected: 에러 없음. (만약 `SUPABASE_URL`/`SUPABASE_ANON_KEY`가 더 이상 안 쓰여 unused 경고가 나면, 다른 사용처가 남아있는지 확인 후 사용처가 없을 때만 import에서 제거. recentCache가 `SUPABASE_URL`을 계속 쓰므로 보통 그대로 유지됨.)

- [ ] **Step 6: 수동 회귀 검증 (최우선 — 서버사이드 필터링 보존 확인)**

dev 서버(`npm run dev`)에서 대시보드 열고 변경 전과 동일한지 확인:
- 기본 목록 + 무한스크롤 다음 페이지 로딩 정상
- **연도 필터**: 특정 연도 범위 → 그 범위 영화만(로드 안 됐던 영화도 포함되어야 함)
- **장르 필터 / 비선호 장르**: 해당 장르만 / 제외
- **검색**: 목록에 아직 안 뜬 영화 제목으로 검색 → 결과 나옴(서버 전체 조회 유지 증거)
- **정렬 토글**(최신순/오래된순): 순서 반전 + 히스토리 유지
- **상세창**: 영화 클릭 → 줄거리·배우·감독·러닝타임·트레일러 정상(Task 2 지연 로드)
- 네트워크 탭에서 목록 요청이 `/api/movies`로 가고 200인지 확인

- [ ] **Step 7: 캐시 동작 확인**

같은 첫 페이지를 새로고침 반복 → `/api/movies` 응답이 동일하고, (가능하면) vm4 쿼리 로그/CPU가 반복 호출에도 증가하지 않는지 확인. (Next.js Data Cache 적중 = 첫 호출만 vm4 접촉)

- [ ] **Step 8: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/dashboard/page.tsx
git commit -m "feat(fe): 대시보드 목록을 /api/movies 캐시 경유 + select 축소"
```

---

## 최종 검증 (전체)

- [ ] `cd 4K_FE && npx tsc --noEmit` 통과
- [ ] `cd 4K_FE && npm run build` 통과(라우트가 빌드에 포함되는지)
- [ ] 위 Task 3 Step 6 회귀 체크리스트 전부 통과
- [ ] (선택) `loadtest/peakly-stress-read.js` 재실행 → 동일 부하에서 vm4 CPU가 이전(100% 포화)보다 완화됐는지 비교, 결과를 `loadtest/REPORT.md`에 3차로 추가

## 배포 메모 (구현 후)

- FE 이미지 빌드 → ArgoCD 동기화(기존 CI 흐름). 라우트는 FE 파드에서 동작하므로 별도 인프라 변경 없음.
- `revalidate`는 파드별 캐시라, 재배포 시 캐시는 비워지고 다시 채워진다(정상).
