# 외부 스코어 API 캐싱 설계 (scene_scores)

작성일: 2026-06-23
상태: 설계 승인됨

## 목적

외부 스코어 API `GET /api/movies/{tmdb_id}/scores`의 DB 부하를 줄여 붕괴점을 올린다.
부하 테스트(2026-06 REPORT)에서 이 엔드포인트는 **무캐시 fan-out**(요청마다 vm4 인증 +
vm5 데이터 2쿼리 + FE 조립)으로 **~750 VU에서 붕괴**(캐시된 영화 목록 ~3600 대비 5배 낮음).
**scene_scores 데이터를 캐싱**해 vm5·FE 조립 부하를 제거한다. 인증(vm4)은 그대로 둔다.

## 배경 / 확정 사실

- 라우트: `4K_FE/app/api/movies/[tmdb_id]/scores/route.ts` — Next.js Route Handler(FE 파드).
  순서: ① `isValidApiKey`(vm4 RPC, `cache: 'no-store'`) → ② `fetchSceneTimeline`(vm5).
- `fetchSceneTimeline`(`4K_FE/app/lib/aiDb.ts`)는 `{kind:'ok'|'not_found'|'upstream_error'}`
  반환. 내부에서 `aiGet`로 vm5 PostgREST 조회(`cache:'no-store'`): scenes(subtitles join) +
  scene_scores. `getActiveBaseVersion`은 모듈 레벨 1회 캐시(파드 생애).
- scene_scores는 **ML 파이프라인 재처리 시에만** 변함(기존 영화는 그 사이 사실상 정적).
- 데이터는 **개인화 아님** — 같은 tmdb_id면 누가(어느 API 키로) 요청하든 동일.
- 영화 목록은 이미 라우트 캐싱(`/api/movies`, revalidate 1h, spec 2026-06-22)으로 개선됨.
- 인프라: Redis/CDN 없음(도입 안 함). Next.js 내장 캐시(FE 파드 내)만 사용.

## 핵심 개념 (왜 이 설정인가)

- **데이터 캐시는 tmdb_id로 키를 잡아 전 고객이 공유한다.** scene_scores가 모두에게 동일하므로
  API 키와 무관. (key, tmdb_id) 조합으로 잡으면 같은 영화가 키마다 쪼개져 적중률만 떨어지므로
  **tmdb_id 단독 키.**
- **인증과 데이터를 분리 캐싱.** 인증(vm4)은 매 요청 그대로 검증 → 키 폐기(revoke) 즉시 반영.
  데이터(vm5)만 캐시 → 보안 유지 + vm5 부하 제거. 라우트가 두 단계를 이미 분리 호출하므로 가능.
- **'ok'만 캐시한다.** `upstream_error`(vm5 일시 장애)를 캐시하면 502를 TTL 내내 반환하는 사고가
  나고, `not_found`를 캐시하면 새로 점수가 생긴 영화가 TTL 동안 404로 남는다. 따라서 이 둘은
  캐시하지 않고 매 요청 재조회(신선도·장애 안전). 캐시 회피는 **throw**로 구현(`unstable_cache`는
  콜백이 throw하면 캐시하지 않음).
- **신선도:** 'ok' 데이터 변경(재처리·모델 롤아웃)은 최대 1h stale. 신규 점수 영화는 not_found를
  캐시 안 하므로 즉시 반영. 능동 무효화는 이번 범위 밖(필요 시 후속).

## 결정 사항

| 항목 | 결정 |
|---|---|
| 캐싱 방식 | `unstable_cache`로 `fetchSceneTimeline` 래핑 (FE 파드 내 Data Cache) |
| 캐시 키 | **tmdb_id** (전 고객 공유, API 키 무관) |
| TTL | `revalidate: 3600` (1시간) |
| 캐시 대상 | **'ok' 결과만**. not_found·upstream_error는 throw로 캐시 회피 |
| 인증(vm4) | **변경 없음** (매 요청 검증) |
| 능동 무효화 | **없음** (범위 밖) |
| Redis/CDN | 미사용 |

## 상세 설계

### `4K_FE/app/lib/aiDb.ts` — 캐시 래퍼 추가

기존 `fetchSceneTimeline`은 그대로 두고, 그 위에 캐시 래퍼를 추가한다:

```ts
import { unstable_cache } from 'next/cache';

// 'ok'가 아니면 throw → unstable_cache가 캐시하지 않음(매 요청 재조회)
class TimelineMiss extends Error {
  constructor(public kind: 'not_found' | 'upstream_error') {
    super(kind);
  }
}

const cachedOkTimeline = unstable_cache(
  async (tmdbId: number): Promise<ScoresResponse> => {
    const r = await fetchSceneTimeline(tmdbId);
    if (r.kind === 'ok') return r.data;
    throw new TimelineMiss(r.kind);
  },
  ['scene-timeline'], // keyParts; 실제 키엔 인자(tmdbId)가 자동 포함됨
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

### `4K_FE/app/api/movies/[tmdb_id]/scores/route.ts` — 호출만 교체

인증·검증·상태코드 매핑은 그대로. 데이터 조회 한 줄만 캐시 버전으로:

```ts
// 변경 전: const result = await fetchSceneTimeline(id);
// 변경 후:
import { getSceneTimelineCached } from '@/app/lib/aiDb';
const result = await getSceneTimelineCached(id);
```

> `fetchSceneTimeline` import가 더 안 쓰이면 정리. 인증(`isValidApiKey`) 호출은 그대로 둔다.

### 데이터 흐름

```
요청 → [인증 vm4: 매 요청] → 통과 시 getSceneTimelineCached(id)
   ├ 캐시 적중(같은 id, 1h 내): FE 파드 메모리 반환 (vm5 미접촉)
   └ 미적중/만료: fetchSceneTimeline → vm5 조회 → 'ok'면 캐시 저장
        (not_found·upstream_error는 throw → 캐시 안 됨 → 다음에 재조회)
```

## 검증

- **동작(회귀):** 유효 키+점수있는 id → 200 + 기존과 동일한 JSON. 잘못된 키 → 401(캐시 무관
  확인 — 폐기 키도 차단). 점수 없는 id → 404. (가능하면 vm5 일시 차단 시 502도 확인)
- **캐시 효과:** 같은 id 반복 호출 시 vm5 쿼리 로그/CPU가 안 늚. `loadtest/peakly-stress-scores*.js`
  재실행 → ~750 VU 천장이 상승(다음 천장은 인증 vm4 또는 FE/app 노드로 이동) 확인.
- **빌드/타입/lint:** `npx tsc --noEmit`, `npx eslint <file>`, `npm run build` 통과.

## 범위 밖 (YAGNI)

- 인증(vm4 API 키 검증) 캐싱 — 키 폐기 즉시성 위해 이번엔 그대로. (다음 천장이 인증이면 후속)
- 능동 캐시 무효화(`revalidateTag`) — 재처리/롤아웃 시 즉시 반영용. 1h TTL로 갈음.
- Redis 등 공유 캐시, CDN.
- `getActiveBaseVersion`의 파드 생애 캐시 동작 변경(기존 그대로).
