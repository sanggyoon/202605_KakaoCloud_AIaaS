# 스코어 API 인증(vm4) 천장 완화 — 인증 캐싱(A) + PostgREST 풀 상향(B) 설계

작성일: 2026-06-23
상태: 설계 승인됨

## 목적

스코어 데이터 캐싱(spec 2026-06-23-scores-api-cache) 적용 후, 외부 스코어 API의 천장이
**vm4 인증(`validate_api_key` RPC)** 으로 드러남. 부하 테스트에서 데이터(vm5)는 캐시로 한가
(~0~20%)한데도 **~500 VU에서 붕괴**(p95 폭증, vm4 CPU는 낮음 = PostgREST 커넥션 풀 대기).
인증 처리량을 올려 스코어 API 천장을 끌어올린다.

근거(측정): 같은 부하 VM 1대로 **캐시된 `/api/movies`(인증 없음)는 3600 VU 도달**, 반면
인증을 매 요청 하는 `/scores`는 ~500에서 막힘 → 차이는 인증뿐. vm4 PostgREST 기본 풀(~10)이
동시 인증 RPC를 ~10건으로 제한 → 대기.

## 배경 / 확정 사실

- 인증: `4K_FE/app/lib/apiKeys.ts`의 `isValidApiKey(provided)` — 평문 키를 sha256 hex로 해시 후
  vm4 `rpc/validate_api_key`(POST, body `{p_hash}`)에 `cache:'no-store'`로 질의, 활성 키 매칭이면
  true. 라우트는 매 요청 호출(캐시 없음).
- vm4 Supabase는 Helm(`Ansible/values/values-data.yaml`, ArgoCD `supabase-data`)로 배포. PostgREST
  컴포넌트명 `rest`. 현재 values엔 풀/커넥션 설정 없음 → **차트 기본값(PGRST_DB_POOL≈10)** 사용.
- vm4 노드 = 2 코어 / ~8GB. Postgres `max_connections` 기본 100(추정), kong/meta/functions/studio가
  같은 예산을 공유. 인증 쿼리는 **인덱스 해시 조회로 가벼움**(vm4 CPU는 부하 중에도 낮았음).
- API 키는 **고객당 1개를 오래 재사용**(서버→서버 소비자). 데이터는 개인화 아님(별도 spec에서 캐싱됨).
- 인프라: Redis/CDN 없음. 트랜잭션 풀러(PgBouncer/Supavisor) 도입은 범위 밖.

## 핵심 개념 (왜 이 설정인가)

- **A(앱 캐싱)와 B(인프라 풀)는 상호보완.** A는 키 재사용 트래픽에서 vm4 호출을 아예 제거(활성 키
  수 ÷ TTL로 감소), B는 캐시 미스·신규/다양한 키여도 vm4가 더 많이 동시 처리. 어떤 트래픽 패턴이든
  인증 천장이 올라간다.
- **풀은 높을수록 좋은 게 아니다.** 연결마다 Postgres 백엔드 프로세스(메모리)·`max_connections`
  공유 슬롯을 쓰고, 코어 수(2)를 넘는 동시성은 Postgres 내부 경합으로 처리량을 못 늘린다. 가벼운
  인증 쿼리 + vm4 2코어 기준 **40**(기본 10의 4배, max_connections 100 미만으로 타 컴포넌트 여지
  확보)이 안전한 시작점. 더 큰 동시성이 필요하면 풀 확대가 아니라 트랜잭션 풀러로(후속).
- **인증 캐싱은 'true/false 둘 다' 캐시하되 RPC 에러는 캐시 안 함.** 에러(vm4 일시 장애)를 false로
  캐싱하면 정상 키가 TTL 동안 거부되어 장애가 길어진다 → 에러는 throw로 캐시 회피(매 요청 재시도).
- **신선도/보안:** 캐시 키는 평문이 아니라 **해시**. TTL 60초 → 키 폐기(revoke)는 최대 60초 지연
  (허용). 신규 발급 키도 최대 60초 후 통과(허용).

## 결정 사항

| 항목 | 결정 |
|---|---|
| A 캐싱 방식 | `unstable_cache`로 검증 함수 래핑(FE 파드 내, Redis 없음) |
| A 캐시 키 | **sha256 해시**(평문 키 아님) |
| A TTL | `revalidate: 60`(60초) — 폐기 지연 최대 60초 |
| A 캐시 대상 | true/false 둘 다. **RPC 에러는 throw로 캐시 회피** |
| B 설정 | `Ansible/values/values-data.yaml`에 `environment.rest.PGRST_DB_POOL: "40"` |
| B max_connections | 기본 유지(100). 부족 징후 시 후속 상향 |
| 배포 순서 | **A 먼저**(앱·저위험) → B(vm4 공유 컴포넌트) |
| 범위 밖 | PgBouncer/Supavisor, Postgres max_connections 상향, Redis/CDN |

## 상세 설계

### Part A — 인증 결과 캐싱 (`4K_FE/app/lib/apiKeys.ts`)

`isValidApiKey`를 해시 기준 캐시로 감싼다. RPC 에러는 throw로 캐시 회피.

```ts
import { unstable_cache } from 'next/cache';

// RPC 에러는 캐시하지 않기 위한 sentinel(throw → unstable_cache가 미캐시)
class AuthCheckError extends Error {}

// 해시 1건당 60초 캐시. true/false 둘 다 캐시(RPC 성공 시), 에러는 throw.
const cachedValidate = unstable_cache(
  async (hash: string): Promise<boolean> => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_api_key`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_hash: hash }),
      cache: 'no-store',
    });
    if (!res.ok) throw new AuthCheckError();
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  },
  ['api-key-valid'], // keyParts; 실제 키엔 인자(hash)가 자동 포함됨
  { revalidate: 60 },
);

export async function isValidApiKey(provided: string | null): Promise<boolean> {
  if (!provided) return false;
  try {
    const hash = await sha256Hex(provided);
    return await cachedValidate(hash);
  } catch {
    return false; // 해시 실패·RPC 에러 → 미캐시 false
  }
}
```

- `sha256Hex`는 기존 함수 재사용. 라우트는 변경 없음(이미 `isValidApiKey` 호출).
- 효과: 같은 키 반복 → vm4 RPC는 60초에 1회. 활성 키 N개면 vm4 인증 부하 ≈ N/60초.

### Part B — vm4 PostgREST 풀 상향 (`Ansible/values/values-data.yaml`)

`environment:` 블록에 `rest` 컴포넌트 환경변수를 추가:

```yaml
environment:
  studio:
    DEFAULT_ORGANIZATION_NAME: 'Default Organization'
    DEFAULT_PROJECT_NAME: 'Service DB'
  rest:
    PGRST_DB_POOL: '40'
```

- 정확한 키 경로(`environment.rest` vs `rest.environment`)는 supabase 차트 스키마로 구현 시 확인.
  PostgREST 풀 환경변수명은 `PGRST_DB_POOL`.
- ArgoCD `supabase-data` 동기화 → `rest`(PostgREST) 파드 롤아웃 → 풀 40 적용.
- max_connections는 그대로(40 + 타 컴포넌트 < 100 여유). 배포 후 Postgres 연결 수·메모리 관찰.

## 검증

- **A 동작(회귀):** 유효 키 → 200, 잘못된/없는 키 → 401, 키 폐기 후 **≤60초 내 차단**. 같은 키
  반복 시 vm4 RPC 로그가 안 늚.
- **A 안전:** vm4 일시 차단(또는 RPC 강제 실패) 시 false가 60초 캐시되지 않고 매 요청 재시도되는지.
- **B 적용:** 배포 후 `rest` 파드 env에 `PGRST_DB_POOL=40` 존재. Postgres 연결 수가 풀 범위 내.
- **종합(천장 상승):** ulimit 올린 부하 VM에서 `loadtest/peakly-stress-scores-max.js` 재실행 →
  **~500 VU 천장 상승** + vm4 인증 대기로 인한 p95 폭증 완화 확인. 결과를 `loadtest/REPORT.md`에 추가.
- 빌드/타입/lint: `npx tsc --noEmit`, `npx eslint`, `npm run build` 통과.

## 범위 밖 (YAGNI)

- 트랜잭션 풀러(PgBouncer/Supavisor) — 수천+ 동시성 필요 시 후속.
- Postgres `max_connections`·메모리 상향 — 모니터링에서 부족할 때.
- Redis/CDN, 능동 캐시 무효화.
