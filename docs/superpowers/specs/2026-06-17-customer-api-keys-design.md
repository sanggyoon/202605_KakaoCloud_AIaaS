# 고객별 API 키 설계 (per-customer API keys)

작성일: 2026-06-17
상태: 설계 승인됨
관련: [2026-06-17-external-scores-api-design.md](2026-06-17-external-scores-api-design.md) 의 **인증 방식 교체**

## 목적

외부 점수 API(`GET /api/movies/[tmdb_id]/scores`)의 인증을 **단일 공유 키
(`SCORES_API_KEY`)** 에서 **고객별 발급 키** 로 교체한다.

불특정 다수 고객이 각자 다른 키로 API를 쓰는 구조다. 요청이 오면 그 키가
"우리가 발급한 유효한 키"인지 조회해 통과시키고, 통과 시 서버가 (고객은 모르는)
내부 자격증명으로 데이터를 가져온다.

### 왜 바꾸나 (v1의 한계)

v1은 `process.env.SCORES_API_KEY` 와 단순 비교 → 모든 고객이 키 하나를 공유해야
한다. 그래서: 고객 구분 불가, 한 고객만 폐기 불가, 고객별 사용량 추적 불가, 한
명이 키를 유출하면 전원 무력화. 다중 고객 공개 API에는 부적합하다.

### 재사용 (v1에서 안 버리는 것)

- `4K_FE/app/lib/aiDb.ts` 전체 (vm5 scene_scores 조회·조립) — 그대로.
- scores 라우트의 응답 스키마(`arousal`/`valence`/`progress_ratio`), 400/404/502
  에러 처리 — 그대로.
- BE의 vm4 service_role 연결(`tmdb_common.sb_headers()` / `DATA_SUPABASE_KEY`).
- 매니저 프록시 라우트·세션(`proxy.ts` / `app/lib/auth.ts`) 패턴.

**바뀌는 핵심은 scores 라우트의 "키 유효성 검사" 한 군데뿐이다.**

## 배경 / 확정 사실

- DB는 둘. **vm4**(`data.peakly.art`) = 데이터 DB, **vm5**(`ai.peakly.art`) = AI DB.
  `scene_scores`는 vm5에만 있다.
- BE(FastAPI, `4K_BE/app/main.py`)는 **vm4에 service_role 키**
  (`DATA_SUPABASE_KEY`, RLS 우회)로 접근한다 — `4K_BE/app/tmdb_common.py`
  `sb_headers()`. 매니저 페이지의 관리 동작은 FE 매니저 라우트 → BE 프록시로 처리.
- FE는 vm4에 **공개 anon 키**(`SUPABASE_ANON_KEY`, `app/lib/data.ts`)로만 접근.
  서버 라우트에서도 이 값을 쓸 수 있다(빌드 시 인라인되는 NEXT_PUBLIC 값).
- 매니저 라우트 보호는 `4K_FE/proxy.ts`(이 커스텀 Next의 미들웨어)의 `matcher`
  목록으로 한다. 현재 `/api/manager/movies*`, `/api/manager/stats`만 세션 게이트.
- 코드 작성 전 `4K_FE/node_modules/next/dist/docs/`로 라우트/미들웨어 시그니처
  확인 (커스텀 Next — `4K_FE/AGENTS.md`).

## 결정 사항

1. **저장소**: `api_keys` 테이블을 **vm4**에 둔다.
2. **발급**: 매니저 페이지 UI(헤더 로그아웃 버튼 왼쪽 '키 발급' 버튼) → FE 매니저
   라우트 → BE 엔드포인트 → vm4 insert(service_role).
3. **검증**: vm4 **RPC `validate_api_key`(SECURITY DEFINER)**. scores 라우트가
   요청 키를 sha-256 해시해 anon 키로 RPC 호출. service_role을 FE에 두지 않음,
   요청당 BE 홉 없음.
4. **해시**: 평문 키는 저장 안 하고 **sha-256 hex(소문자)** 만 저장. 유출돼도
   원문 복원 불가.
5. **폐기**: 소프트(`active=false`). 행은 남겨 감사/last_used 보존.
6. **범위 밖(YAGNI)**: rate limit, 사용량 과금, 키 회전 자동화, 스코프/권한 등급.

## 상세 설계

### ① vm4 DB

마이그레이션 SQL(레포에 보관, vm4 Supabase Studio에서 실행):
`4K_BE/DB_SCRIPTS/api_keys.sql` (신규).

테이블:

```sql
create table if not exists api_keys (
  id           bigint generated always as identity primary key,
  name         text   not null,            -- 고객/용도 식별 라벨
  key_hash     text   not null unique,      -- sha-256 hex(소문자)
  key_prefix   text   not null,            -- 평문 앞 일부 (목록 식별용, 예: peakly_AB12)
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
```

검증 RPC (SECURITY DEFINER — 호출자는 테이블을 직접 못 봐도 해시 1건 조회 가능):

```sql
create or replace function validate_api_key(p_hash text)
returns table (name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update api_keys
       set last_used_at = now()
     where key_hash = p_hash and active = true
    returning api_keys.name;
end;
$$;

revoke all on function validate_api_key(text) from public;
grant execute on function validate_api_key(text) to anon;
```

- 유효하면 `last_used_at` 갱신 후 `name` 1행 반환, 무효면 0행.
- `anon`에 EXECUTE만 부여 → FE가 anon 키로 호출 가능, 테이블 직접 노출 없음.

### ② BE (FastAPI, `4K_BE/app/main.py`)

vm4 service_role(`tc.sb_headers()`)로 `api_keys`를 관리하는 엔드포인트 3개.
키 생성·해시는 표준 라이브러리(`secrets`, `hashlib`)만 사용.

키 형식: `peakly_` + `secrets.token_urlsafe(24)`. `key_prefix` = 평문 앞 12자.
`key_hash` = `hashlib.sha256(plaintext.encode()).hexdigest()`.

- `POST /api/api-keys` body `{ "name": "<라벨>" }`
  - 평문 키 생성 → 해시 → vm4 insert `{name, key_hash, key_prefix}`
  - 응답 `{ id, name, key, key_prefix, created_at }` — **`key`(평문)는 이 응답에서만 1회 노출**
  - `name` 누락 → 400
- `GET /api/api-keys`
  - 응답 `[{ id, name, key_prefix, active, created_at, last_used_at }]` (평문 없음)
- `DELETE /api/api-keys/{id}`
  - vm4 PATCH `active=false` (소프트 폐기). 없으면 404.

### ③ FE 매니저

**프록시 라우트** (기존 `app/api/manager/active-model/route.ts` 패턴 = BE 프록시):
- `app/api/manager/api-keys/route.ts` — `GET`(목록), `POST`(생성) → BE로 프록시
- `app/api/manager/api-keys/[id]/route.ts` — `DELETE`(폐기) → BE로 프록시

**보호** (`4K_FE/proxy.ts`):
- `matcher`에 `'/api/manager/api-keys'`, `'/api/manager/api-keys/:path*'` 추가
- 미인증 시 JSON 401을 주도록, 401 분기 조건에도
  `pathname.startsWith('/api/manager/api-keys')` 추가

**UI** (`app/manager/page.tsx`):
- 헤더의 **로그아웃 버튼 바로 왼쪽**에 '키 발급'(또는 'API 키') 버튼 추가
- 버튼 클릭 → 패널/모달:
  - **목록**: `GET /api/manager/api-keys` — name, key_prefix, 상태(active), 생성일,
    마지막 사용. 각 행에 '폐기' 버튼(`DELETE`, active만)
  - **생성**: 이름 입력 → `POST /api/manager/api-keys` → 응답의 평문 `key`를
    **1회 표시 + 복사 버튼**, "다시 볼 수 없음" 경고
  - 폐기/생성 후 목록 새로고침
- 매니저 페이지 기존 스타일(인라인 스타일/모달 패턴)을 따른다.

### ④ FE scores 라우트 (공개)

`app/api/movies/[tmdb_id]/scores/route.ts` 수정 + 검증 로직 분리.

**신규 `app/lib/apiKeys.ts`**:

```ts
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/app/lib/data';

// 평문 키 → sha-256 hex(소문자). BE의 hashlib.sha256(...).hexdigest()와 일치.
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// vm4 validate_api_key RPC로 키 유효성 확인. 유효하면 true.
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

**라우트 인증 교체**: 기존

```ts
const expected = process.env.SCORES_API_KEY;
const provided = request.headers.get('x-api-key');
if (!expected || provided !== expected) {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
```

→

```ts
const provided = request.headers.get('x-api-key');
if (!(await isValidApiKey(provided))) {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
```

이후 흐름(검증·404·502·200, `fetchSceneTimeline`)은 동일.

### 환경 변수

- **FE**: 검증은 기존 `SUPABASE_URL`/`SUPABASE_ANON_KEY`(vm4 anon) 재사용 → 신규
  env 없음. 데이터 조회용 `AI_DATABASE_URL`/`AI_DATABASE_KEY`는 그대로.
  `.env.example`에서 **`SCORES_API_KEY` 제거**(더 이상 안 씀).
- **BE**: 기존 `DATA_SUPABASE_URL`/`DATA_SUPABASE_KEY`(service_role) 재사용 →
  신규 env 없음.

## 검증

- FE: `npx tsc --noEmit`, `npx eslint <변경파일>`(변경 파일만 클린), `npm run build`.
- BE: `python -m py_compile app/main.py` (구문 점검; 별도 러너 없음).
- e2e 스모크(로컬, vm4 도달 시):
  1. 매니저 로그인 → `POST /api/manager/api-keys {name:"test"}` → 평문 키 수령
  2. 그 키로 `GET /api/movies/11/scores` (`X-API-Key`) → **200**
  3. 틀린 키 → **401**
  4. `DELETE /api/manager/api-keys/{id}` → 같은 키로 재요청 → **401**

## 범위 밖 (YAGNI)

- rate limiting / 사용량 과금 / 쿼터
- 키 자동 회전·만료(TTL)
- 키 스코프·권한 등급
- 발급 시 이메일 전송 등 고객 온보딩 자동화
