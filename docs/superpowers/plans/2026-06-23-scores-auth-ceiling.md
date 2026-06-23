# 스코어 API 인증 천장 완화 (인증 캐싱 + PostgREST 풀) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부 스코어 API의 vm4 인증 천장을 올린다 — (A) `isValidApiKey` 결과를 해시 기준 60초 캐시, (B) vm4 PostgREST 풀을 40으로 상향.

**Architecture:** A는 `apiKeys.ts`에서 `unstable_cache`로 검증 함수를 해시 키 기준 60초 캐시(true/false 캐시, RPC 에러는 throw로 회피). B는 Supabase Helm values(`values-data.yaml`)에 `rest` 컴포넌트 `PGRST_DB_POOL=40`을 추가. 둘은 독립 배포(A=FE 이미지, B=supabase-data ArgoCD), A 먼저.

**Tech Stack:** Next.js 16.2.5 (`unstable_cache`), TypeScript, Supabase Helm chart(PostgREST `rest`).

## Global Constraints

- A 캐시 키 = **sha256 해시**(평문 키 금지). TTL = `revalidate: 60`.
- A는 true/false 둘 다 캐시하되 **RPC 비2xx/네트워크 에러는 throw로 캐시 회피**(매 요청 재시도).
- A는 `isValidApiKey` **시그니처 불변**(`(provided: string | null) => Promise<boolean>`) — 라우트 변경 없음.
- B = `environment.rest.PGRST_DB_POOL: '40'`. Postgres `max_connections`는 변경 금지(관찰만).
- 배포 순서 **A 먼저 → B**. Redis/CDN/PgBouncer 도입 금지.
- 테스트 프레임워크 없음 → 검증은 `npx tsc --noEmit`, `npx eslint <file>`, `npm run build`,
  dev 서버 + curl, 부하 재실행. FE 명령은 `4K_FE/`에서.

---

## Task 1 (A): 인증 결과 캐싱 (`apiKeys.ts`)

**Files:**
- Modify: `4K_FE/app/lib/apiKeys.ts`

**Interfaces:**
- Consumes: 기존 `sha256Hex`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (같은 파일/import).
- Produces: `isValidApiKey(provided: string | null): Promise<boolean>` (시그니처 동일, 내부만 캐시).

- [ ] **Step 1: import 추가**

`4K_FE/app/lib/apiKeys.ts` 최상단(첫 줄 `import { SUPABASE_URL ... }` 위 또는 아래)에 추가:

```ts
import { unstable_cache } from 'next/cache';
```

- [ ] **Step 2: `isValidApiKey`를 캐시 래퍼로 교체**

기존 `isValidApiKey` 함수 전체:

```ts
// vm4 validate_api_key RPC로 키 유효성 확인. 유효(활성 키 1건 매칭)하면 true.
export async function isValidApiKey(provided: string | null): Promise<boolean> {
  if (!provided) return false;
  try {
    const hash = await sha256Hex(provided);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_api_key`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_hash: hash }),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}
```

을 다음으로 교체:

```ts
// RPC 에러를 캐시하지 않기 위한 sentinel(throw → unstable_cache가 미캐시).
class AuthCheckError extends Error {}

// 해시 1건당 60초 캐시. true/false 둘 다 캐시(RPC 성공 시), 에러는 throw해 캐시 회피.
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
  ['api-key-valid'], // keyParts; 실제 캐시 키엔 인자(hash)가 자동 포함됨
  { revalidate: 60 },
);

// vm4 validate_api_key RPC로 키 유효성 확인. 결과를 해시 기준 60초 캐시.
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

- [ ] **Step 3: 타입/린트 검증**

Run: `cd 4K_FE && npx tsc --noEmit && npx eslint app/lib/apiKeys.ts`
Expected: 에러 없음(exit 0).

- [ ] **Step 4: dev 서버 회귀 검증 (키 없이 가능한 범위)**

별도 터미널에서 `cd 4K_FE && npm run dev` 실행 후:

```bash
# 키 없음 / 잘못된 키 → 401 (인증 자체는 정상 동작)
curl -s -o /dev/null -w "no key → %{http_code}\n" "http://localhost:3000/api/movies/550/scores"
curl -s -o /dev/null -w "badkey → %{http_code}\n" -H "X-API-Key:WRONG" "http://localhost:3000/api/movies/550/scores"
```
Expected: 둘 다 `401`. (유효 키 → 200 및 "같은 키 반복 시 vm4 RPC 미증가"는 키 보유 시 사용자가 확인.)

- [ ] **Step 5: 빌드 + 커밋**

```bash
cd 4K_FE && npm run build 2>&1 | grep -E "Compiled|Failed" | head -1
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/lib/apiKeys.ts
git commit -m "feat(fe): API 키 검증 결과 60초 캐시(해시 기준, 에러 미캐시)"
```

---

## Task 2 (B): vm4 PostgREST 풀 상향 (`values-data.yaml`)

**Files:**
- Modify: `Ansible/values/values-data.yaml`

**Interfaces:**
- Consumes: 없음(Helm values).
- Produces: `rest`(PostgREST) 파드에 `PGRST_DB_POOL=40` 환경변수.

- [ ] **Step 1: 차트의 환경변수 키 경로 확인**

supabase 차트에서 `rest` 컴포넌트 환경변수 주입 경로를 확인한다(`environment.rest` 가정).

Run(둘 중 가능한 것):
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
# argocd app에서 차트 출처 확인
grep -nE "repoURL|chart|targetRevision|path" Ansible/manifests/argocd/argocd-app-supabase-data.yaml
# 차트가 로컬/캐시에 있으면 values 스키마 확인
helm show values <chart> 2>/dev/null | grep -nA3 -iE "^environment:|  rest:" | head -20 || true
```
Expected: `environment:` 하위에 컴포넌트별(`studio`, `rest` 등) 키가 있음을 확인. (이미 `values-data.yaml`에 `environment.studio`가 동작 중이므로 `environment.rest`도 동일 패턴으로 유효할 가능성 높음. 만약 차트가 `rest.environment` 형식이면 Step 2를 그 경로로 조정.)

- [ ] **Step 2: `environment.rest.PGRST_DB_POOL` 추가**

`Ansible/values/values-data.yaml`의 기존 블록:

```yaml
environment:
  studio:
    DEFAULT_ORGANIZATION_NAME: 'Default Organization'
    DEFAULT_PROJECT_NAME: 'Service DB'
```

을 다음으로 교체(=`rest` 항목 추가):

```yaml
environment:
  studio:
    DEFAULT_ORGANIZATION_NAME: 'Default Organization'
    DEFAULT_PROJECT_NAME: 'Service DB'
  rest:
    # PostgREST DB 커넥션 풀(기본 ~10 → 40). 인증 RPC 동시 처리량 상향.
    PGRST_DB_POOL: '40'
```

- [ ] **Step 3: YAML 유효성 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project && python3 -c "import yaml,sys; yaml.safe_load(open('Ansible/values/values-data.yaml')); print('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/values/values-data.yaml
git commit -m "chore(infra): vm4 PostgREST 풀 40으로 상향(PGRST_DB_POOL) — 인증 동시성"
```

---

## 최종 검증 (배포 후 — 사용자)

- [ ] **A 배포:** FE 이미지 빌드 → ArgoCD 동기화.
- [ ] **B 배포:** `supabase-data` ArgoCD 동기화 → `rest` 파드 롤아웃 후
  `kubectl exec`/`describe`로 `PGRST_DB_POOL=40` 적용 확인. Postgres 연결 수가 풀 범위 내인지 관찰.
- [ ] **A 회귀:** 유효 키 → 200, 같은 키 반복 시 vm4 RPC 미증가, 키 폐기 후 ≤60초 차단.
- [ ] **천장 상승:** ulimit 올린 부하 VM에서 `loadtest/peakly-stress-scores-max.js` 재실행 →
  **~500 VU 천장 상승** + vm4 인증 대기 p95 폭증 완화. 결과를 `loadtest/REPORT.md`에 추가.
  - 그래도 안 오르면: B 적용 여부 재확인, 또는 부하 생성기 한계(부하 VM `top`/추가 VM) 점검.

## 배포 메모

- A·B는 독립 배포. A(앱)는 스코어 인증 경로만 영향(저위험). B(vm4 PostgREST)는 **공유 컴포넌트**라
  목록 캐시미스·매니저 등 전 REST에 영향 → 배포 후 vm4 관찰.
- 캐시는 파드별이라 FE 재배포 시 비워지고 다시 채워짐(정상).
