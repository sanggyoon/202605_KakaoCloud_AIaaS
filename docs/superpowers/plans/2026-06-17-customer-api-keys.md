# 고객별 API 키 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** scores API 인증을 단일 공유 키에서 매니저가 발급하는 고객별 API 키(vm4 `api_keys` 테이블 + sha-256 해시 + SECURITY DEFINER RPC 검증)로 교체한다.

**Architecture:** vm4에 `api_keys` 테이블과 `validate_api_key` RPC를 둔다. BE(FastAPI)가 service_role로 키를 발급/목록/폐기하고, 매니저 페이지 UI가 BE를 프록시로 호출한다. 공개 scores 라우트는 요청 키를 sha-256 해시해 vm4 RPC(anon)로 검증한다. vm5 데이터 조회(`aiDb.ts`)는 그대로 재사용한다.

**Tech Stack:** Postgres/PostgREST(vm4 Supabase), FastAPI(httpx), Next.js 16.2.5 App Router(TypeScript, Web Crypto).

## Global Constraints

- 작업 디렉토리 둘: `4K_FE/`(프론트), `4K_BE/`(FastAPI). import alias(FE): `@/*` → `./*`.
- 코드 작성 전 `4K_FE/node_modules/next/dist/docs/`로 라우트/미들웨어 시그니처 확인 (커스텀 Next — `4K_FE/AGENTS.md`). **동적 라우트 시그니처:** `export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> })`, `const { id } = await params;`.
- **테스트 러너 없음.** FE 검증 = `npx tsc --noEmit` + `npx eslint <변경파일>`(변경 파일만 클린) + `npm run build`. BE 검증 = `python -m py_compile app/main.py`. 런타임은 `curl` 스모크. 기존 파일 pre-existing 에러는 무시(변경 파일만 클린).
- **해시 일치(중요):** 평문 키 해시는 FE/BE 모두 **sha-256 hex 소문자**. BE `hashlib.sha256(s.encode()).hexdigest()`, FE Web Crypto `crypto.subtle.digest('SHA-256', ...)`.
- **키 형식:** `peakly_` + `secrets.token_urlsafe(24)`. `key_prefix` = 평문 앞 12자.
- BE는 vm4를 `tc.sb_headers()`(service_role `DATA_SUPABASE_KEY`)로, FE 검증은 `SUPABASE_URL`/`SUPABASE_ANON_KEY`(vm4 anon, `app/lib/data.ts`)로 접근. 신규 env 없음.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 작업 브랜치: `feat/customer-api-keys` (이미 생성됨).

## File Structure

- **Create** `4K_BE/DB_SCRIPTS/api_keys.sql` — vm4 `api_keys` 테이블 + `validate_api_key` RPC DDL. vm4 Supabase Studio에서 수동 실행(배포 단계).
- **Modify** `4K_BE/app/main.py` — 발급/목록/폐기 엔드포인트 3개 추가.
- **Create** `4K_FE/app/api/manager/api-keys/route.ts` — BE 프록시(GET 목록, POST 생성).
- **Create** `4K_FE/app/api/manager/api-keys/[id]/route.ts` — BE 프록시(DELETE 폐기).
- **Modify** `4K_FE/proxy.ts` — `matcher`와 401 분기에 `/api/manager/api-keys` 추가.
- **Create** `4K_FE/app/components/ApiKeyManager.tsx` — 매니저용 키 발급/목록/폐기 모달.
- **Modify** `4K_FE/app/manager/page.tsx` — 헤더 로그아웃 왼쪽 'API 키' 버튼 + 모달 연결.
- **Create** `4K_FE/app/lib/apiKeys.ts` — 요청 키 sha-256 해시 + vm4 RPC 검증(`isValidApiKey`).
- **Modify** `4K_FE/app/api/movies/[tmdb_id]/scores/route.ts` — 단일 키 비교 → `isValidApiKey`.
- **Modify** `4K_FE/.env.example` — `SCORES_API_KEY` 제거.

---

### Task 1: vm4 DB 마이그레이션 (`api_keys.sql`)

**Files:**
- Create: `4K_BE/DB_SCRIPTS/api_keys.sql`

**Interfaces:**
- Produces: vm4 테이블 `api_keys(id, name, key_hash unique, key_prefix, active, created_at, last_used_at)` + RPC `validate_api_key(p_hash text) returns table(name text)`.

- [ ] **Step 1: SQL 파일 작성**

`4K_BE/DB_SCRIPTS/api_keys.sql` 전체:

```sql
-- 고객별 API 키 — vm4(data.peakly.art)에서 실행.
-- 평문 키는 저장하지 않고 sha-256 hex(소문자)만 저장한다.

create table if not exists api_keys (
  id           bigint generated always as identity primary key,
  name         text   not null,            -- 고객/용도 식별 라벨
  key_hash     text   not null unique,      -- sha-256 hex(소문자)
  key_prefix   text   not null,            -- 평문 앞 12자 (목록 식별용)
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- 검증 RPC: 해시 1건을 조회·갱신. SECURITY DEFINER라 호출자(anon)가
-- 테이블을 직접 못 읽어도 이 함수로는 유효성만 확인할 수 있다.
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

- [ ] **Step 2: 커밋**

```bash
cd 4K_BE && git add DB_SCRIPTS/api_keys.sql
git commit -m "$(printf 'feat(db): vm4 api_keys 테이블 + validate_api_key RPC\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

- [ ] **Step 3: vm4에 적용 (배포 단계, 수동)**

vm4 Supabase Studio → SQL Editor에서 `api_keys.sql` 내용을 실행한다. (DDL은 PostgREST로 못 하므로 Studio/psql 필요.) 이후 Task 2·5의 e2e 스모크가 이 테이블/RPC를 사용한다. 적용 불가 환경이면 e2e는 건너뛰고 정적 검증으로 갈음한다.

---

### Task 2: BE 키 발급/목록/폐기 엔드포인트 (`main.py`)

**Files:**
- Modify: `4K_BE/app/main.py`

**Interfaces:**
- Consumes: `tc.sb_headers()` (vm4 service_role 헤더), `DATA_URL` (모듈 상수).
- Produces: `POST /api/api-keys {name}` → `{id,name,key,key_prefix,created_at}`; `GET /api/api-keys` → `[{id,name,key_prefix,active,created_at,last_used_at}]`; `DELETE /api/api-keys/{key_id}` → `{ok,id}`.

- [ ] **Step 1: 표준 라이브러리 import 추가**

`4K_BE/app/main.py` 상단 import 블록(`import json` / `import os` 근처)에 두 줄 추가:

```python
import hashlib
import secrets
```

- [ ] **Step 2: 엔드포인트 3개 추가**

`4K_BE/app/main.py` 끝부분(다른 `@app` 핸들러들과 같은 최상위 레벨)에 추가:

```python
# ── 고객별 API 키 (vm4 api_keys, service_role) ──────────────────
@app.post("/api/api-keys")
async def create_api_key(payload: dict):
    name = (payload or {}).get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name이 필요합니다")
    plaintext = f"peakly_{secrets.token_urlsafe(24)}"
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    key_prefix = plaintext[:12]
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.post(
            f"{DATA_URL}/rest/v1/api_keys",
            json=[{"name": name, "key_hash": key_hash, "key_prefix": key_prefix}],
            headers={**tc.sb_headers(), "Prefer": "return=representation"},
        )
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"키 저장 실패: {r.text[:200]}")
        row = r.json()[0]
    return {
        "id": row["id"],
        "name": row["name"],
        "key": plaintext,          # 평문은 이 응답에서만 1회 노출
        "key_prefix": row["key_prefix"],
        "created_at": row["created_at"],
    }


@app.get("/api/api-keys")
async def list_api_keys():
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.get(
            f"{DATA_URL}/rest/v1/api_keys",
            params={
                "select": "id,name,key_prefix,active,created_at,last_used_at",
                "order": "created_at.desc",
            },
            headers=tc.sb_headers(),
        )
        if r.status_code not in (200, 206):
            raise HTTPException(status_code=500, detail=f"키 목록 실패: {r.text[:200]}")
        return r.json()


@app.delete("/api/api-keys/{key_id}")
async def revoke_api_key(key_id: int):
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.patch(
            f"{DATA_URL}/rest/v1/api_keys",
            params={"id": f"eq.{key_id}"},
            json={"active": False},
            headers={**tc.sb_headers(), "Prefer": "return=representation"},
        )
        if r.status_code not in (200, 204):
            raise HTTPException(status_code=500, detail=f"키 폐기 실패: {r.text[:200]}")
        rows = r.json() if r.text else []
        if not rows:
            raise HTTPException(status_code=404, detail="키를 찾을 수 없습니다")
    return {"ok": True, "id": key_id}
```

- [ ] **Step 3: 구문 점검**

Run: `cd 4K_BE && python -m py_compile app/main.py && echo "PY OK"`
Expected: `PY OK`

- [ ] **Step 4: (vm4 적용됐으면) 로컬 BE 스모크**

`4K_BE/.env`에 `DATA_SUPABASE_URL`/`DATA_SUPABASE_KEY`가 있으면:

```bash
cd 4K_BE && uvicorn app.main:app --port 8000 &   # 별도 셸 가능
# 생성
curl -s -X POST localhost:8000/api/api-keys -H 'Content-Type: application/json' -d '{"name":"smoke"}'
# Expected: {"id":...,"name":"smoke","key":"peakly_...","key_prefix":"peakly_...","created_at":"..."}
# 목록
curl -s localhost:8000/api/api-keys
# Expected: [{"id":...,"name":"smoke","key_prefix":"peakly_...","active":true,...}]  (key 평문 없음)
# 이름 없음 → 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8000/api/api-keys -H 'Content-Type: application/json' -d '{}'
# Expected: 400
```

> vm4 미적용/도달 불가면 이 단계 생략(py_compile로 갈음). BE 서버는 확인 후 종료.

- [ ] **Step 5: 커밋**

```bash
cd 4K_BE && git add app/main.py
git commit -m "$(printf 'feat(api): 고객 API 키 발급/목록/폐기 엔드포인트\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: FE 매니저 프록시 라우트 + 세션 보호 (`api-keys` routes, `proxy.ts`)

**Files:**
- Create: `4K_FE/app/api/manager/api-keys/route.ts`
- Create: `4K_FE/app/api/manager/api-keys/[id]/route.ts`
- Modify: `4K_FE/proxy.ts`

**Interfaces:**
- Consumes: BE Task 2 엔드포인트, env `BE_INTERNAL_URL`.
- Produces: 매니저 전용(세션 보호) `GET/POST /api/manager/api-keys`, `DELETE /api/manager/api-keys/[id]`.

- [ ] **Step 1: 목록/생성 프록시 라우트**

`4K_FE/app/api/manager/api-keys/route.ts` 전체:

```ts
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET() {
  const res = await fetch(`${BE_URL}/api/api-keys`, { cache: 'no-store' });
  const data = await res.json().catch(() => []);
  return Response.json(data, { status: res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${BE_URL}/api/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
```

- [ ] **Step 2: 폐기 프록시 라우트**

`4K_FE/app/api/manager/api-keys/[id]/route.ts` 전체:

```ts
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${BE_URL}/api/api-keys/${id}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
```

- [ ] **Step 3: `proxy.ts` 세션 게이트 추가**

`4K_FE/proxy.ts`에서 두 곳을 수정한다.

(a) 401 JSON 분기 조건에 `api-keys` 추가:

```ts
  // 관리 API는 JSON 401로 응답 (페이지 리다이렉트 대신)
  if (
    pathname.startsWith('/api/manager/movies') ||
    pathname.startsWith('/api/manager/stats') ||
    pathname.startsWith('/api/manager/api-keys')
  ) {
    return NextResponse.json({ detail: '인증이 필요합니다.' }, { status: 401 });
  }
```

(b) `config.matcher` 배열에 두 항목 추가:

```ts
    '/api/manager/stats',
    '/api/manager/api-keys',
    '/api/manager/api-keys/:path*',
```

- [ ] **Step 4: 정적 검증**

Run: `cd 4K_FE && npx tsc --noEmit 2>&1 | grep -iE "manager/api-keys|proxy.ts" || echo "NO ERRORS"`
Expected: `NO ERRORS`

Run: `cd 4K_FE && npx eslint "app/api/manager/api-keys/route.ts" "app/api/manager/api-keys/[id]/route.ts" proxy.ts`
Expected: 출력 없음 (클린)

- [ ] **Step 5: 미인증 차단 스모크**

```bash
cd 4K_FE && npm run dev &   # 준비될 때까지 대기
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/manager/api-keys
# Expected: 401  (세션 쿠키 없음 → proxy.ts가 막음)
```

> dev 서버는 확인 후 종료(다음 태스크에서 다시 사용 가능).

- [ ] **Step 6: 커밋**

```bash
cd 4K_FE && git add "app/api/manager/api-keys/route.ts" "app/api/manager/api-keys/[id]/route.ts" proxy.ts
git commit -m "$(printf 'feat(fe): 매니저 api-keys 프록시 라우트 + 세션 보호\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: FE 매니저 키 관리 UI (`ApiKeyManager.tsx`, `manager/page.tsx`)

**Files:**
- Create: `4K_FE/app/components/ApiKeyManager.tsx`
- Modify: `4K_FE/app/manager/page.tsx`

**Interfaces:**
- Consumes: 매니저 프록시 라우트(Task 3).
- Produces: `<ApiKeyManager open onClose />` 모달; 매니저 헤더의 'API 키' 버튼.

- [ ] **Step 1: ApiKeyManager 컴포넌트 작성**

`4K_FE/app/components/ApiKeyManager.tsx` 전체:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface ApiKeyRow {
  id: number;
  name: string;
  key_prefix: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
}

interface CreatedKey {
  id: number;
  name: string;
  key: string;
  key_prefix: string;
}

export default function ApiKeyManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/manager/api-keys', { cache: 'no-store' });
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setCreated(null);
      setError('');
      load();
    }
  }, [open]);

  const create = async () => {
    if (!name.trim()) return;
    setError('');
    const res = await fetch('/api/manager/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      setError('키 생성에 실패했습니다.');
      return;
    }
    setCreated((await res.json()) as CreatedKey);
    setName('');
    load();
  };

  const revoke = async (id: number) => {
    await fetch(`/api/manager/api-keys/${id}`, { method: 'DELETE' });
    load();
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 100%)', maxHeight: '80vh', overflowY: 'auto',
          background: 'rgba(16,17,23,0.98)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14, padding: 24, color: 'var(--fg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>API 키 관리</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {/* 생성 폼 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="키 이름 (예: customer-acme)"
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--fg)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button
            onClick={create}
            style={{
              padding: '9px 16px', borderRadius: 8, border: '1px solid var(--accent)',
              background: 'color-mix(in oklch, var(--accent) 18%, transparent)',
              color: 'var(--fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            발급
          </button>
        </div>
        {error && <div style={{ color: 'rgb(239,120,120)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

        {/* 새로 생성된 평문 키 — 1회 표시 */}
        {created && (
          <div style={{
            margin: '8px 0 16px', padding: 14, borderRadius: 10,
            background: 'rgba(123,97,255,0.1)', border: '1px solid rgba(123,97,255,0.35)',
          }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              아래 키는 <b>지금 한 번만</b> 표시됩니다. 복사해 안전하게 보관하세요.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all', color: '#fff' }}>{created.key}</code>
              <button
                onClick={() => navigator.clipboard?.writeText(created.key)}
                style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: 'var(--fg)', fontSize: 12, cursor: 'pointer' }}
              >
                복사
              </button>
            </div>
          </div>
        )}

        {/* 목록 */}
        {loading ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: '12px 0' }}>로딩 중...</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: '12px 0' }}>발급된 키가 없습니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                borderRadius: 8, background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)', opacity: r.active ? 1 : 0.5,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                    {r.key_prefix}… · {new Date(r.created_at).toLocaleDateString('ko-KR')}
                    {r.last_used_at ? ` · 최근 ${new Date(r.last_used_at).toLocaleDateString('ko-KR')}` : ' · 미사용'}
                  </div>
                </div>
                {r.active ? (
                  <button
                    onClick={() => revoke(r.id)}
                    style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: 'rgb(239,120,120)', fontSize: 12, cursor: 'pointer' }}
                  >
                    폐기
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>폐기됨</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 매니저 페이지에 버튼 + 모달 연결**

`4K_FE/app/manager/page.tsx`를 세 군데 수정한다.

(a) 파일 상단 import에 추가 (다른 컴포넌트 import 근처):

```tsx
import ApiKeyManager from '@/app/components/ApiKeyManager';
```

(b) 컴포넌트 함수 본문에서 `handleLogout` 위에 상태 추가:

```tsx
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
```

> `useState`가 이미 import되어 있지 않으면 `import { useState } from 'react';`에 추가한다.

(c) 헤더의 로그아웃 `<button>`을 아래처럼 flex 래퍼로 감싸 왼쪽에 'API 키' 버튼을 둔다. 기존 로그아웃 `<button onClick={handleLogout} ...>로그아웃</button>` 전체를 다음으로 교체:

```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setApiKeyOpen(true)}
            title="API 키 관리"
            style={{
              padding: '8px 14px',
              background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
              border: '1px solid color-mix(in oklch, var(--accent) 35%, transparent)',
              borderRadius: 7,
              color: 'var(--fg)',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            API 키
          </button>
          <button
            onClick={handleLogout}
            title="로그아웃"
            style={{
              padding: '8px 14px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 7,
              color: 'rgb(239,120,120)',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            로그아웃
          </button>
        </div>
```

(d) 최상위 컨테이너 `<div>` 닫기 직전(마지막 `</main>` 다음, 바깥 `</div>` 직전)에 모달을 렌더:

```tsx
      <ApiKeyManager open={apiKeyOpen} onClose={() => setApiKeyOpen(false)} />
```

- [ ] **Step 3: 정적 검증 + 빌드**

Run: `cd 4K_FE && npx tsc --noEmit 2>&1 | grep -iE "ApiKeyManager|manager/page" || echo "NO ERRORS"`
Expected: `NO ERRORS`

Run: `cd 4K_FE && npx eslint app/components/ApiKeyManager.tsx app/manager/page.tsx`
Expected: 출력 없음 (클린)

Run: `cd 4K_FE && npm run build 2>&1 | grep -E "Compiled|error|Error|Failed" | head -3`
Expected: `✓ Compiled successfully`

- [ ] **Step 4: 커밋**

```bash
cd 4K_FE && git add app/components/ApiKeyManager.tsx app/manager/page.tsx
git commit -m "$(printf 'feat(fe): 매니저 API 키 관리 모달 + 헤더 버튼\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: scores 라우트 검증 교체 (`apiKeys.ts`, `scores/route.ts`, `.env.example`)

**Files:**
- Create: `4K_FE/app/lib/apiKeys.ts`
- Modify: `4K_FE/app/api/movies/[tmdb_id]/scores/route.ts`
- Modify: `4K_FE/.env.example`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (`@/app/lib/data`), vm4 RPC `validate_api_key` (Task 1).
- Produces: `isValidApiKey(provided: string | null): Promise<boolean>`.

- [ ] **Step 1: 검증 유틸 작성**

`4K_FE/app/lib/apiKeys.ts` 전체:

```ts
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/app/lib/data';

// 평문 키 → sha-256 hex(소문자). BE hashlib.sha256(...).hexdigest()와 일치.
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

- [ ] **Step 2: scores 라우트 인증 교체**

`4K_FE/app/api/movies/[tmdb_id]/scores/route.ts`에서 import 추가 후 인증 블록 교체.

import 라인 추가(파일 상단 `fetchSceneTimeline` import 아래):

```ts
import { isValidApiKey } from '@/app/lib/apiKeys';
```

기존 인증 블록

```ts
  // 1. 인증: X-API-Key == SCORES_API_KEY. 키 미설정 시에도 401(안전 기본값).
  const expected = process.env.SCORES_API_KEY;
  const provided = request.headers.get('x-api-key');
  if (!expected || provided !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
```

를 다음으로 교체:

```ts
  // 1. 인증: X-API-Key를 vm4 api_keys(해시)와 대조. 유효한 활성 키만 통과.
  const provided = request.headers.get('x-api-key');
  if (!(await isValidApiKey(provided))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
```

- [ ] **Step 3: `.env.example`에서 SCORES_API_KEY 제거**

`4K_FE/.env.example`에서 아래 두 줄을 삭제한다(앞 주석 줄 포함):

```
# 외부 호출자 인증 키 — 요청의 X-API-Key 헤더와 비교. 미설정 시 모든 요청 401.
# SCORES_API_KEY=<random secret>
```

> `AI_DATABASE_URL`/`AI_DATABASE_KEY` 주석은 그대로 둔다(데이터 조회에 여전히 필요).

- [ ] **Step 4: 정적 검증 + 빌드**

Run: `cd 4K_FE && npx tsc --noEmit 2>&1 | grep -iE "apiKeys|scores/route" || echo "NO ERRORS"`
Expected: `NO ERRORS`

Run: `cd 4K_FE && npx eslint app/lib/apiKeys.ts "app/api/movies/[tmdb_id]/scores/route.ts"`
Expected: 출력 없음 (클린)

Run: `cd 4K_FE && npm run build 2>&1 | grep -E "Compiled|error|Error|Failed" | head -3`
Expected: `✓ Compiled successfully`

- [ ] **Step 5: 무효 키 스모크 (vm4 도달 시)**

`.env.local`에 vm4 anon(`NEXT_PUBLIC_SUPABASE_*` 미설정 시 data.ts 기본값 사용)과 `AI_DATABASE_KEY`가 있는 상태에서:

```bash
cd 4K_FE && npm run dev &   # 준비 대기
curl -s -o /dev/null -w "%{http_code}\n" -H "X-API-Key: definitely-not-valid" http://localhost:3000/api/movies/11/scores
# Expected: 401  (RPC가 매칭 0건)
```

- [ ] **Step 6: e2e 스모크 (Task 1 vm4 적용 + BE 실행 시에만)**

```bash
# 1) BE로 키 발급 (매니저 세션 우회 위해 BE 직접 호출)
KEY=$(curl -s -X POST localhost:8000/api/api-keys -H 'Content-Type: application/json' -d '{"name":"e2e"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["key"])')
# 2) 그 키로 scores 호출 → 200
curl -s -o /dev/null -w "valid key → %{http_code}\n" -H "X-API-Key: $KEY" http://localhost:3000/api/movies/11/scores
# Expected: valid key → 200
```

> vm4 미적용/BE 미실행이면 Step 5(무효 키 401)까지로 갈음. dev/BE 서버는 확인 후 종료.

- [ ] **Step 7: 커밋**

```bash
cd 4K_FE && git add app/lib/apiKeys.ts "app/api/movies/[tmdb_id]/scores/route.ts" .env.example
git commit -m "$(printf 'feat(api): scores 인증을 고객 API 키(vm4 RPC) 검증으로 교체\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 완료 후

- `superpowers:finishing-a-development-branch`로 main 머지/PR 결정.
- **배포 체크리스트:**
  1. vm4에 `api_keys.sql` 적용 (Task 1 Step 3) — 안 하면 운영에서 모든 키 401.
  2. BE/FE 재배포 (BE는 `DATA_SUPABASE_KEY`, FE는 vm4 anon + `AI_DATABASE_KEY` 필요 — 모두 기존 값 재사용, 신규 시크릿 없음).
  3. 운영 `SCORES_API_KEY`는 더 이상 불필요(제거 가능).
- push 거부 시 `git fetch origin && git rebase origin/main` 후 재push.
