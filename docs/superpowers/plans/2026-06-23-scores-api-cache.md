# 외부 스코어 API 캐싱 (scene_scores) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부 스코어 API의 vm5 데이터 조회를 tmdb_id 단위 1시간 캐시로 감싸 DB 부하를 줄이고 붕괴점을 올린다. 인증(vm4)은 그대로 둔다.

**Architecture:** `aiDb.ts`에 `unstable_cache`로 `fetchSceneTimeline`을 래핑한 `getSceneTimelineCached`를 추가하고('ok'만 캐시, 그 외엔 throw로 캐시 회피), 스코어 라우트의 데이터 조회 한 줄을 캐시 버전으로 교체. 캐시는 FE 파드 내 Data Cache(Redis/CDN 없음), tmdb_id로 키가 잡혀 전 고객이 공유한다.

**Tech Stack:** Next.js 16.2.5 (App Router, `unstable_cache` from `next/cache`), TypeScript, vm5 PostgREST.

## Global Constraints

- 캐시 키 = **tmdb_id 단독** (전 고객 공유, API 키 무관). (key, tmdb_id) 조합 금지.
- TTL = `revalidate: 3600` (1시간).
- **'ok' 결과만 캐시.** `not_found`·`upstream_error`는 throw로 캐시 회피(매 요청 재조회).
- **인증(`isValidApiKey`, vm4)은 변경 금지** — 매 요청 검증(키 폐기 즉시 반영).
- 능동 무효화 없음. Redis/CDN 없음. Next.js 내장 캐시만.
- 테스트 프레임워크 없음 → 검증은 `npx tsc --noEmit`, `npx eslint <file>`, `npm run build`,
  dev 서버 + curl(회귀), 부하 재실행(캐시 효과). 모든 명령은 `4K_FE/`에서.

---

## Task 1: `aiDb.ts`에 캐시 래퍼 추가 (additive, 동작 변화 없음)

**Files:**
- Modify: `4K_FE/app/lib/aiDb.ts`

**Interfaces:**
- Consumes: 기존 `fetchSceneTimeline(tmdbId: number): Promise<TimelineResult>`, `ScoresResponse`, `TimelineResult` (같은 파일).
- Produces: `getSceneTimelineCached(tmdbId: number): Promise<TimelineResult>` — 'ok'는 1h 캐시, not_found·upstream_error는 캐시 안 함.

- [ ] **Step 1: 파일 상단에 import 추가**

`4K_FE/app/lib/aiDb.ts` 제일 위(주석 블록 다음, 첫 `const AI_DATABASE_URL` 위)에 추가:

```ts
import { unstable_cache } from 'next/cache';
```

- [ ] **Step 2: 파일 끝에 캐시 래퍼 추가**

`fetchSceneTimeline` 함수 정의가 끝나는 파일 맨 끝에 추가:

```ts

// 'ok'가 아니면 throw → unstable_cache가 캐시하지 않음(매 요청 재조회).
class TimelineMiss extends Error {
  constructor(public kind: 'not_found' | 'upstream_error') {
    super(kind);
  }
}

// scene timeline을 tmdb_id 단위로 1시간 캐시(전 고객 공유). 'ok'만 캐시.
const cachedOkTimeline = unstable_cache(
  async (tmdbId: number): Promise<ScoresResponse> => {
    const r = await fetchSceneTimeline(tmdbId);
    if (r.kind === 'ok') return r.data;
    throw new TimelineMiss(r.kind);
  },
  ['scene-timeline'], // keyParts; 실제 캐시 키엔 인자(tmdbId)가 자동 포함됨
  { revalidate: 3600 },
);

export async function getSceneTimelineCached(
  tmdbId: number,
): Promise<TimelineResult> {
  try {
    return { kind: 'ok', data: await cachedOkTimeline(tmdbId) };
  } catch (e) {
    if (e instanceof TimelineMiss) return { kind: e.kind };
    return { kind: 'upstream_error' };
  }
}
```

- [ ] **Step 3: 타입/린트 검증**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/lib/aiDb.ts`
Expected: 에러 없음(exit 0). (`fetchSceneTimeline`은 아직 다른 곳에서 쓰이므로 unused 경고 없음.)

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/lib/aiDb.ts
git commit -m "feat(fe): scene timeline 캐시 래퍼(getSceneTimelineCached, 1h, ok만)"
```

---

## Task 2: 스코어 라우트가 캐시 버전을 쓰도록 교체 + 검증

**Files:**
- Modify: `4K_FE/app/api/movies/[tmdb_id]/scores/route.ts`

**Interfaces:**
- Consumes: `getSceneTimelineCached`(Task 1), `isValidApiKey`(기존, 변경 없음).
- Produces: 동작 동일(200/401/404/502)하되 데이터 조회는 캐시 경유.

- [ ] **Step 1: import 교체**

`route.ts` 상단 import에서 `fetchSceneTimeline`을 `getSceneTimelineCached`로 교체.

변경 전:
```ts
import { fetchSceneTimeline } from '@/app/lib/aiDb';
```
변경 후:
```ts
import { getSceneTimelineCached } from '@/app/lib/aiDb';
```

- [ ] **Step 2: 데이터 조회 호출 교체**

라우트 본문(인증·tmdb_id 검증 이후)의 호출 한 줄을 교체. 인증(`isValidApiKey`) 블록은 그대로 둔다.

변경 전:
```ts
  const result = await fetchSceneTimeline(id);
```
변경 후:
```ts
  const result = await getSceneTimelineCached(id);
```

- [ ] **Step 3: 타입/린트/빌드 검증**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/api/movies/[tmdb_id]/scores/route.ts && npm run build`
Expected: 모두 통과. build 출력에 `ƒ /api/movies/[tmdb_id]/scores` 존재.

- [ ] **Step 4: dev 서버 회귀 검증 (인증·정상·404)**

별도 터미널에서 `cd 4K_FE && npm run dev` 실행해 둔 뒤, 유효 API 키와 점수 있는 tmdb_id를 준비:

```bash
# 점수 있는 영화 id 하나 확보
curl -s 'http://localhost:3000/api/movies?select=tmdb_id&has_vector=eq.true&limit=1'

KEY='<발급한 고객 API 키>'
ID='<위에서 얻은 tmdb_id>'

# 1) 정상: 200 + JSON(arousal/valence/progress_ratio)
curl -s -o /dev/null -w "valid → %{http_code}\n" -H "X-API-Key:$KEY" "http://localhost:3000/api/movies/$ID/scores"
# 2) 잘못된 키: 401 (캐시 무관 — 인증은 매 요청)
curl -s -o /dev/null -w "badkey → %{http_code}\n" -H "X-API-Key:WRONG" "http://localhost:3000/api/movies/$ID/scores"
# 3) 없는 영화: 404
curl -s -o /dev/null -w "missing → %{http_code}\n" -H "X-API-Key:$KEY" "http://localhost:3000/api/movies/999999999/scores"
# 4) 같은 id 2회: 둘 다 200 (2번째는 캐시 적중) — 응답 동일해야
curl -s -H "X-API-Key:$KEY" "http://localhost:3000/api/movies/$ID/scores" | head -c 120; echo
curl -s -H "X-API-Key:$KEY" "http://localhost:3000/api/movies/$ID/scores" | head -c 120; echo
```
Expected: `valid → 200`, `badkey → 401`, `missing → 404`, 4)의 두 응답이 동일.

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add "4K_FE/app/api/movies/[tmdb_id]/scores/route.ts"
git commit -m "feat(fe): 스코어 API 데이터 조회를 캐시 경유로 전환(getSceneTimelineCached)"
```

---

## 최종 검증 (전체)

- [ ] `cd 4K_FE && npx tsc --noEmit` 통과
- [ ] `cd 4K_FE && npm run build` 통과
- [ ] Task 2 Step 4 회귀 체크(200/401/404 + 같은 id 2회 동일) 통과
- [ ] **캐시 효과 측정:** 배포(FE 이미지 빌드→ArgoCD) 후 `loadtest/peakly-stress-scores-high.js`
  재실행 → 같은 key/소수 id 부하에서 **vm5 CPU가 낮게 유지 + ~750 VU 천장이 상승**하는지 확인.
  결과를 `loadtest/REPORT.md`에 추가.
  - 다음 천장 예상: 인증(vm4) 또는 FE/app 노드. (그게 인증이면 후속으로 인증 캐싱 검토)

## 배포 메모

- FE 이미지 빌드 → ArgoCD 동기화(기존 CI). 라우트·캐시는 FE 파드에서 동작, 인프라 변경 없음.
- 캐시는 파드별이라 재배포 시 비워지고 다시 채워짐(정상).
