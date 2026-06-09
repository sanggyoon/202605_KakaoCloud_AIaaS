# 매니저 페이지 (`/manager`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/movie_list`에서 운영/모니터링 기능을 분리해, 서비스 모니터링(방문자·영화 데이터 통계)과 주요 기능 진입점을 모은 매니저 허브 `/manager` 페이지를 만든다.

**Architecture:** 공개 페이지(`/`, `/dashboard`)는 진입 시 방문 비콘을 BE로 보내 Supabase `visits`에 기록한다. 매니저 허브는 BE `/api/stats`로 visits·movies count를 집계해 카드로 보여주고, backfill을 실행한다. 매니저 페이지는 Next 16 `proxy.ts`로 세션 쿠키를 검사해 가드한다.

**Tech Stack:** Next.js 16.2.5 (App Router, `proxy.ts`), React 19, FastAPI(httpx), Supabase PostgREST, pytest.

**Spec:** `docs/superpowers/specs/2026-06-09-manager-page-design.md`

**작업 디렉터리 주의:** BE 작업은 `4K_BE/`, FE 작업은 `4K_FE/`. 모든 명령은 해당 디렉터리에서 실행한다. 커밋은 리포 루트(`/Users/sanggyoon/Documents/KakaoCloud_Project`)에서 한다.

---

## File Structure

**Backend (`4K_BE/`)**
- Create: `DB_SCRIPTS/visits_schema.sql` — `visits` 테이블 DDL
- Modify: `app/main.py` — `POST /api/visits`, `GET /api/stats`, count 헬퍼 추가
- Test: `tests/test_stats.py` — visits insert + stats 집계 테스트

**Frontend (`4K_FE/`)**
- Modify: `app/lib/data.ts` — `logVisit()` 헬퍼 추가
- Create: `app/api/visit/route.ts` — 공개 방문 비콘 프록시
- Create: `app/api/manager/stats/route.ts` — 통계 프록시(매니저 전용)
- Create: `app/manager/page.tsx` — 매니저 허브
- Modify: `app/page.tsx` — 마운트 시 `logVisit()` 호출
- Modify: `app/dashboard/page.tsx` — 마운트 시 `logVisit()` 호출
- Modify: `app/movie_list/page.tsx` — backfill 제거, 백링크를 `/manager`로 변경
- Modify: `app/login/page.tsx` — 기본 리다이렉트 `/movie_list` → `/manager`
- Create: `proxy.ts` (리포: `4K_FE/proxy.ts`) — 매니저 페이지 세션 가드

---

## Task 1: BE — `visits` 테이블 DDL

**Files:**
- Create: `4K_BE/DB_SCRIPTS/visits_schema.sql`

- [ ] **Step 1: SQL 파일 작성**

`4K_BE/DB_SCRIPTS/visits_schema.sql`:

```sql
-- 공개 서비스 방문 기록. 브라우저당 하루 1행(FE에서 스로틀).
-- 운영 Supabase(data.peakly.art)에 수동 적용한다.
create table if not exists visits (
  id         bigint generated always as identity primary key,
  visitor_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists visits_created_at_idx on visits (created_at);
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/DB_SCRIPTS/visits_schema.sql
git commit -m "feat(be): visits 테이블 DDL 추가"
```

---

## Task 2: BE — `POST /api/visits` (방문 기록)

**Files:**
- Modify: `4K_BE/app/main.py`
- Test: `4K_BE/tests/test_stats.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_BE/tests/test_stats.py` (신규):

```python
import httpx
from fastapi.testclient import TestClient
from app import main


def _patch_client(monkeypatch, handler):
    _orig = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs.pop("timeout", None)
        kwargs.pop("verify", None)
        return _orig(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(main.httpx, "AsyncClient", factory)


def test_log_visit_inserts(monkeypatch):
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        captured["body"] = req.content
        return httpx.Response(201, json=[])

    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    res = client.post("/api/visits", json={"visitor_id": "abc-123"})
    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert "/rest/v1/visits" in captured["url"]
    assert b"abc-123" in captured["body"]


def test_log_visit_requires_visitor_id(monkeypatch):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(201, json=[])

    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    res = client.post("/api/visits", json={})
    assert res.status_code == 400
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_BE && python -m pytest tests/test_stats.py -v`
Expected: FAIL — `404 Not Found` (엔드포인트 미존재)

- [ ] **Step 3: 엔드포인트 구현**

`4K_BE/app/main.py` — 기존 import 블록 아래(`from app import backfill_popular as bf` 다음 줄)에 추가:

```python
from datetime import datetime, timedelta, timezone
```

그리고 `delete_movie` 함수 끝(파일 맨 아래)에 추가:

```python
@app.post("/api/visits")
async def log_visit(payload: dict):
    """공개 서비스 방문 기록 — FE 비콘이 브라우저당 하루 1회 호출한다."""
    visitor_id = (payload.get("visitor_id") or "").strip()
    if not visitor_id:
        raise HTTPException(status_code=400, detail="visitor_id is required")
    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        r = await client.post(
            f"{tc.data_url()}/rest/v1/visits",
            json=[{"visitor_id": visitor_id}],
            headers=tc.sb_headers(),
        )
        if r.status_code not in (200, 201, 204):
            raise HTTPException(status_code=500, detail=f"방문 기록 실패: {r.text[:200]}")
    return {"ok": True}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_BE && python -m pytest tests/test_stats.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/main.py 4K_BE/tests/test_stats.py
git commit -m "feat(be): POST /api/visits 방문 기록 엔드포인트"
```

---

## Task 3: BE — `GET /api/stats` (집계)

**Files:**
- Modify: `4K_BE/app/main.py`
- Test: `4K_BE/tests/test_stats.py`

- [ ] **Step 1: 실패하는 테스트 추가**

`4K_BE/tests/test_stats.py` 끝에 추가:

```python
def test_stats_returns_counts(monkeypatch):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/rest/v1/movies" in url and "has_vector=eq.true" in url:
            return httpx.Response(206, json=[], headers={"Content-Range": "0-0/30"})
        if "/rest/v1/movies" in url:
            return httpx.Response(206, json=[], headers={"Content-Range": "0-0/100"})
        if "/rest/v1/visits" in url:
            return httpx.Response(206, json=[], headers={"Content-Range": "0-0/42"})
        return httpx.Response(404)

    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    res = client.get("/api/stats")
    assert res.status_code == 200
    data = res.json()
    assert data["visitors"]["total"] == 42
    assert data["visitors"]["day"] == 42
    assert data["movies"]["total"] == 100
    assert data["movies"]["with_graph"] == 30
    assert data["movies"]["without_graph"] == 70


def test_stats_handles_missing_content_range(monkeypatch):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])  # Content-Range 없음

    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    res = client.get("/api/stats")
    assert res.status_code == 200
    assert res.json()["movies"]["total"] == 0
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_BE && python -m pytest tests/test_stats.py::test_stats_returns_counts -v`
Expected: FAIL — `404 Not Found`

- [ ] **Step 3: count 헬퍼 + 엔드포인트 구현**

`4K_BE/app/main.py` — Task 2에서 추가한 `log_visit` 함수 위(또는 아래)에 추가:

```python
def _parse_count(content_range: str | None) -> int:
    """PostgREST count 응답의 Content-Range("0-0/1234" 또는 "*/0")에서 total 파싱."""
    if not content_range or "/" not in content_range:
        return 0
    total = content_range.rsplit("/", 1)[-1]
    return int(total) if total.isdigit() else 0


async def _count(client: httpx.AsyncClient, table: str, params: dict) -> int:
    """Supabase 테이블의 행 수를 count=exact 헤더로 조회."""
    headers = tc.sb_headers()
    headers["Prefer"] = "count=exact"
    headers["Range-Unit"] = "items"
    headers["Range"] = "0-0"
    r = await client.get(
        f"{tc.data_url()}/rest/v1/{table}",
        params={"select": "id", **params},
        headers=headers,
    )
    if r.status_code not in (200, 206):
        return 0
    return _parse_count(r.headers.get("content-range"))


@app.get("/api/stats")
async def stats():
    """매니저 모니터링용 집계 — 방문자(기간별) + 영화 데이터(그래프 유무)."""
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)
    month_start = now - timedelta(days=30)

    async with httpx.AsyncClient(timeout=15, verify=False) as client:
        total_v = await _count(client, "visits", {})
        month_v = await _count(client, "visits", {"created_at": f"gte.{month_start.isoformat()}"})
        week_v = await _count(client, "visits", {"created_at": f"gte.{week_start.isoformat()}"})
        day_v = await _count(client, "visits", {"created_at": f"gte.{day_start.isoformat()}"})
        total_m = await _count(client, "movies", {})
        with_graph = await _count(client, "movies", {"has_vector": "eq.true"})

    return {
        "visitors": {"total": total_v, "month": month_v, "week": week_v, "day": day_v},
        "movies": {
            "total": total_m,
            "with_graph": with_graph,
            "without_graph": total_m - with_graph,
        },
    }
```

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `cd 4K_BE && python -m pytest tests/test_stats.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: 회귀 확인**

Run: `cd 4K_BE && python -m pytest -q`
Expected: 기존 테스트 포함 전부 PASS

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/main.py 4K_BE/tests/test_stats.py
git commit -m "feat(be): GET /api/stats 방문자·영화 데이터 집계"
```

---

## Task 4: FE — 방문 비콘 헬퍼 `logVisit()`

**Files:**
- Modify: `4K_FE/app/lib/data.ts`

- [ ] **Step 1: 헬퍼 추가**

`4K_FE/app/lib/data.ts` 끝(파일 맨 아래, `removeRecentId` 다음)에 추가:

```typescript
// 공개 서비스 방문 비콘 — 브라우저당 하루 1회만 전송(fire-and-forget).
// localStorage에 방문자 UUID와 마지막 방문일(YYYY-MM-DD)을 저장해 중복 전송을 막는다.
export function logVisit(): void {
  if (typeof window === 'undefined') return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('4k_last_visit') === today) return;

    let visitorId = localStorage.getItem('4k_visitor_id');
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      localStorage.setItem('4k_visitor_id', visitorId);
    }
    localStorage.setItem('4k_last_visit', today);

    fetch('/api/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: visitorId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* localStorage 접근 불가 등은 무시 */
  }
}
```

- [ ] **Step 2: 린트 확인**

Run: `cd 4K_FE && npm run lint`
Expected: 에러 없음 (경고는 허용)

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/lib/data.ts
git commit -m "feat(fe): logVisit 방문 비콘 헬퍼 추가"
```

---

## Task 5: FE — 공개 방문 프록시 `POST /api/visit`

**Files:**
- Create: `4K_FE/app/api/visit/route.ts`

- [ ] **Step 1: 라우트 작성**

`4K_FE/app/api/visit/route.ts`:

```typescript
// 공개 방문 비콘 — BE /api/visits로 프록시. 인증 불필요, 실패는 조용히 처리.
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${BE_URL}/api/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch {
    // 비콘 실패는 사용자 경험에 영향 주지 않음
    return Response.json({ ok: false }, { status: 200 });
  }
}
```

- [ ] **Step 2: 린트 확인**

Run: `cd 4K_FE && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/api/visit/route.ts
git commit -m "feat(fe): POST /api/visit 공개 방문 프록시"
```

---

## Task 6: FE — 통계 프록시 `GET /api/manager/stats`

**Files:**
- Create: `4K_FE/app/api/manager/stats/route.ts`

- [ ] **Step 1: 라우트 작성**

`4K_FE/app/api/manager/stats/route.ts` (`app/api/manager/movies/recent/route.ts` 패턴을 따름):

```typescript
// 매니저 모니터링 통계 — BE /api/stats로 프록시.
const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET() {
  const res = await fetch(`${BE_URL}/api/stats`, { cache: 'no-store' });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
```

- [ ] **Step 2: 린트 확인**

Run: `cd 4K_FE && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/api/manager/stats/route.ts
git commit -m "feat(fe): GET /api/manager/stats 통계 프록시"
```

---

## Task 7: FE — 공개 페이지에서 `logVisit()` 호출

**Files:**
- Modify: `4K_FE/app/page.tsx`
- Modify: `4K_FE/app/dashboard/page.tsx`

- [ ] **Step 1: 랜딩 페이지(`/`)에 마운트 효과 추가**

`4K_FE/app/page.tsx` — import 수정:

```typescript
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { logVisit } from '@/app/lib/data';
import BackgroundThread from '@/app/components/BackgroundThread';
```

그리고 `export default function OnboardingPage() {` 본문에서 `const router = useRouter();` 바로 다음 줄에 추가:

```typescript
  useEffect(() => {
    logVisit();
  }, []);
```

- [ ] **Step 2: 메인 서비스(`/dashboard`)에 마운트 효과 추가**

`4K_FE/app/dashboard/page.tsx` — import 목록의 `from '@/app/lib/data'` 블록에 `logVisit`를 추가한다. 현재:

```typescript
  fetchPreferredMovies,
} from '@/app/lib/data';
```

를 다음으로 변경:

```typescript
  fetchPreferredMovies,
  logVisit,
} from '@/app/lib/data';
```

그리고 `export default function Dashboard() {` 본문에서 `const router = useRouter();` 바로 다음 줄에 추가:

```typescript
  useEffect(() => {
    logVisit();
  }, []);
```

(`useEffect`는 이미 `app/dashboard/page.tsx` 상단에서 import되어 있으므로 추가 import 불필요.)

- [ ] **Step 2.5: `/` 페이지의 `useEffect` import 중복 확인**

`app/page.tsx`는 기존에 `useEffect`를 import하지 않으므로 Step 1에서 추가한 import가 유일해야 한다. 중복 import가 없는지 확인한다.

- [ ] **Step 3: 린트 확인**

Run: `cd 4K_FE && npm run lint`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/page.tsx 4K_FE/app/dashboard/page.tsx
git commit -m "feat(fe): 공개 페이지 진입 시 방문 비콘 호출"
```

---

## Task 8: FE — 매니저 허브 `/manager`

**Files:**
- Create: `4K_FE/app/manager/page.tsx`

- [ ] **Step 1: 허브 페이지 작성**

`4K_FE/app/manager/page.tsx` — backfill 로직은 기존 `app/movie_list/page.tsx`의 `runBackfill`/진행 배너를 이전한 것이다:

```tsx
'use client';

// 매니저 허브 — 서비스 모니터링(방문자/영화 데이터 통계) + 주요 기능 진입점.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Stats {
  visitors: { total: number; month: number; week: number; day: number };
  movies: { total: number; with_graph: number; without_graph: number };
}

export default function ManagerPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  // backfill(신규 100개 추가) 진행 상태
  const [backfill, setBackfill] = useState<{
    running: boolean;
    processed: number;
    target: number;
    title: string | null;
    done: { added: number; failed: number } | null;
  } | null>(null);

  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const res = await fetch('/api/manager/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error('stats 조회 실패');
      setStats(await res.json());
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // 신규 100개 수동 추가 — CronJob과 동일한 backfill을 즉시 실행, NDJSON 진행 스트림 소비
  const runBackfill = async () => {
    if (backfill?.running) return;
    setBackfill({ running: true, processed: 0, target: 100, title: null, done: null });
    try {
      const res = await fetch('/api/manager/movies/backfill', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error('backfill 시작 실패');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let doneEv: { added: number; failed: number } | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'progress') {
            setBackfill((s) => (s ? { ...s, processed: ev.processed, target: ev.target, title: ev.title } : s));
          } else if (ev.type === 'done') {
            doneEv = { added: ev.added, failed: (ev.failed ?? []).length };
          }
        }
      }
      setBackfill((s) => (s ? { ...s, running: false, done: doneEv ?? { added: 0, failed: 0 } } : s));
      // 새 영화가 추가됐으므로 통계 갱신
      fetchStats();
    } catch {
      setBackfill((s) => (s ? { ...s, running: false, done: { added: 0, failed: 0 } } : s));
    }
  };

  const handleLogout = async () => {
    await fetch('/api/manager/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  const fmt = (n: number | undefined) =>
    statsLoading || n === undefined ? '—' : n.toLocaleString('ko-KR');

  return (
    <div style={{
      width: '100%', minHeight: '100vh',
      background: 'var(--bg)', color: 'var(--fg)',
      fontFamily: 'var(--font-sans), "Inter Tight", sans-serif',
    }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 64px',
        background: 'rgba(8,9,13,0.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>서비스 모니터링</h1>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--accent)', background: 'color-mix(in oklch, var(--accent) 14%, transparent)', padding: '3px 8px', borderRadius: 4 }}>MANAGER</span>
        </div>
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
      </header>

      <main style={{ padding: '32px 64px 60px', display: 'flex', flexDirection: 'column', gap: 36 }}>
        {/* 방문자 통계 */}
        <section>
          <h2 style={sectionTitle}>방문자 통계</h2>
          <div style={cardGrid}>
            <StatCard label="누적 방문" value={fmt(stats?.visitors.total)} />
            <StatCard label="한 달 (30일)" value={fmt(stats?.visitors.month)} />
            <StatCard label="1주일 (7일)" value={fmt(stats?.visitors.week)} />
            <StatCard label="하루 (오늘)" value={fmt(stats?.visitors.day)} />
          </div>
        </section>

        {/* 영화 데이터 통계 */}
        <section>
          <h2 style={sectionTitle}>영화 데이터</h2>
          <div style={cardGrid}>
            <StatCard label="전체 영화" value={fmt(stats?.movies.total)} />
            <StatCard label="그래프 있음" value={fmt(stats?.movies.with_graph)} accent />
            <StatCard label="그래프 없음" value={fmt(stats?.movies.without_graph)} />
          </div>
        </section>

        {/* 기능 버튼 */}
        <section>
          <h2 style={sectionTitle}>기능</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <button onClick={() => router.push('/movie_list')} style={actionBtn(false)}>
              영화 정보 리스트 →
            </button>
            <button onClick={runBackfill} disabled={backfill?.running} style={actionBtn(!!backfill?.running)}>
              {backfill?.running ? '추가 중…' : '새로운 영화 100개 추가'}
            </button>
            <button
              disabled
              title="추후 개발된 모델로 동작 예정"
              style={{ ...actionBtn(true), cursor: 'not-allowed' }}
            >
              영화 데이터 스코어링 (준비 중)
            </button>
          </div>
        </section>

        {/* Backfill 진행 배너 */}
        {backfill && (
          <div style={{ padding: '14px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                {backfill.running
                  ? `신규 영화 추가 중… ${backfill.processed} / ${backfill.target}${backfill.title ? ` — ${backfill.title}` : ''}`
                  : `완료 — 신규 ${backfill.done?.added ?? 0}개 추가${backfill.done?.failed ? `, 실패 ${backfill.done.failed}개` : ''}`}
              </span>
              {!backfill.running && (
                <button
                  onClick={() => setBackfill(null)}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
                >
                  닫기
                </button>
              )}
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, Math.round(((backfill.running ? backfill.processed : backfill.done?.added ?? 0) / Math.max(1, backfill.target)) * 100))}%`,
                  background: backfill.running ? 'var(--accent)' : 'rgba(34,197,94,0.85)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 12, padding: '20px 22px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', color: accent ? 'var(--accent)' : 'var(--fg)' }}>{value}</span>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  margin: '0 0 14px', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.5)',
};

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 16,
};

function actionBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '14px 22px',
    border: 'none', borderRadius: 10,
    background: disabled ? 'rgba(255,255,255,0.06)' : 'color-mix(in oklch, var(--accent) 20%, transparent)',
    color: disabled ? 'rgba(255,255,255,0.4)' : 'var(--accent)',
    fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
  };
}
```

- [ ] **Step 2: 린트 확인**

Run: `cd 4K_FE && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/manager/page.tsx
git commit -m "feat(fe): /manager 매니저 허브 페이지(모니터링 + 기능 버튼)"
```

---

## Task 9: FE — `/movie_list`에서 backfill 제거, 백링크 변경

**Files:**
- Modify: `4K_FE/app/movie_list/page.tsx`

- [ ] **Step 1: backfill state 제거**

`app/movie_list/page.tsx`에서 다음 블록(주석 포함, `const [backfill, setBackfill] = ...` 전체)을 삭제:

```typescript
  // backfill(신규 100개 추가) 진행 상태
  const [backfill, setBackfill] = useState<{
    running: boolean;
    processed: number;
    target: number;
    title: string | null;
    done: { added: number; failed: number } | null;
  } | null>(null);
```

- [ ] **Step 2: `runBackfill` 함수 제거**

`// 신규 100개 수동 추가 ...` 주석부터 시작하는 `const runBackfill = async () => { ... };` 함수 전체를 삭제 (Step 1 spec의 movie_list 69~101행에 해당하는 블록).

- [ ] **Step 3: 헤더의 "신규 100개 추가" 버튼 + 구분선 제거**

Pagination `<div>` 내부에서 다음 블록을 삭제(버튼과 그 양옆 구분선 한 쌍):

```tsx
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
          <button
            onClick={runBackfill}
            disabled={backfill?.running}
            title="TMDB 인기작 중 DB에 없는 영화를 최대 100개 추가 (3시 자동 작업과 동일)"
            style={{
              padding: '8px 14px',
              background: backfill?.running ? 'rgba(255,255,255,0.06)' : 'color-mix(in oklch, var(--accent) 20%, transparent)',
              border: 'none', borderRadius: 7,
              color: backfill?.running ? 'rgba(255,255,255,0.4)' : 'var(--accent)',
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
              cursor: backfill?.running ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {backfill?.running ? '추가 중…' : '신규 100개 추가'}
          </button>
```

(바로 아래에 남는 로그아웃 버튼 앞 구분선은 유지한다 — 검색/페이지네이션 영역과 로그아웃 사이 구분선.)

- [ ] **Step 4: 진행 배너 블록 제거**

`{/* Backfill 진행 배너 */}` 주석부터 시작하는 `{backfill && ( ... )}` 블록 전체를 삭제.

- [ ] **Step 5: 백링크를 `/manager`로 변경**

다음 버튼을 변경:

```tsx
          <button
            onClick={() => router.push('/dashboard')}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: 0 }}
          >
            ← 대시보드
          </button>
```

를:

```tsx
          <button
            onClick={() => router.push('/manager')}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: 0 }}
          >
            ← 매니저
          </button>
```

- [ ] **Step 6: 린트 확인 (미사용 변수 잔존 검사 포함)**

Run: `cd 4K_FE && npm run lint`
Expected: 에러 없음. `backfill`/`setBackfill`/`runBackfill` 미사용 경고가 나오면 해당 잔존 코드를 마저 제거.

- [ ] **Step 7: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/movie_list/page.tsx
git commit -m "refactor(fe): movie_list에서 backfill 제거, 백링크를 /manager로"
```

---

## Task 10: FE — 로그인 기본 리다이렉트 변경 + `proxy.ts` 가드

**Files:**
- Modify: `4K_FE/app/login/page.tsx`
- Create: `4K_FE/proxy.ts`

- [ ] **Step 1: 로그인 기본 리다이렉트 변경**

`app/login/page.tsx`에서:

```typescript
      router.replace(next && next.startsWith('/') ? next : '/movie_list');
```

를:

```typescript
      router.replace(next && next.startsWith('/') ? next : '/manager');
```

- [ ] **Step 2: `proxy.ts` 작성**

`4K_FE/proxy.ts` (앱 루트, `app/`와 같은 레벨). Next 16에서 `middleware`는 deprecated → `proxy.ts`. Proxy는 기본 Node.js 런타임이라 `auth.ts`의 `node:crypto`가 동작한다:

```typescript
// 매니저 페이지 세션 가드 — 미인증 접근은 /login?next=로 리다이렉트.
// Next 16: middleware → proxy 로 이름 변경됨. Proxy는 기본 Node.js 런타임.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isValidSession, SESSION_COOKIE } from '@/app/lib/auth';

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (isValidSession(token)) {
    return NextResponse.next();
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/manager', '/manager/:path*', '/movie_list', '/movie_list/:path*'],
};
```

- [ ] **Step 3: 빌드로 타입/구성 검증**

Run: `cd 4K_FE && npm run build`
Expected: 빌드 성공. proxy 관련 런타임/타입 오류 없음. (실패 시: `@/app/lib/auth` 경로, `runtime` config를 proxy에 두지 않았는지 확인 — Next 16 proxy에 `runtime` 설정 시 에러.)

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/login/page.tsx 4K_FE/proxy.ts
git commit -m "feat(fe): 매니저 페이지 proxy 세션 가드 + 로그인 기본 리다이렉트 /manager"
```

---

## Task 11: 통합 수동 검증

**Files:** (없음 — 실행 검증만)

- [ ] **Step 1: BE 전체 테스트**

Run: `cd 4K_BE && python -m pytest -q`
Expected: 전부 PASS

- [ ] **Step 2: FE 빌드**

Run: `cd 4K_FE && npm run build`
Expected: 성공

- [ ] **Step 3: 수동 시나리오 점검(개발 서버 기동 시)**

체크리스트:
1. 로그아웃 상태에서 `/manager`, `/movie_list` 접근 → `/login?next=...`로 리다이렉트되는지.
2. 로그인(`admin`/`admin` 기본값) → `/manager`로 이동하는지.
3. `/manager`: 방문자/영화 데이터 카드가 숫자(또는 BE 미연결 시 `—`)로 표시되는지.
4. `/manager` "영화 정보 리스트 →" → `/movie_list` 이동, movie_list에 backfill 버튼/배너가 없는지, "← 매니저" 백링크 동작.
5. `/manager` "새로운 영화 100개 추가" → 진행 배너 표시, 완료 후 영화 데이터 카드 수치 갱신.
6. "영화 데이터 스코어링 (준비 중)" 버튼은 비활성.
7. 공개 페이지 `/` 또는 `/dashboard` 진입 후, `visits` 테이블에 당일 1행이 기록되고 같은 브라우저 재방문 시 중복 기록되지 않는지(localStorage `4k_last_visit` 확인).

- [ ] **Step 4: (선택) 브랜치 정리**

`superpowers:finishing-a-development-branch` 스킬로 PR/머지 옵션 진행.

---

## Self-Review 메모

- **Spec 커버리지:** 방문자 통계(Task 1–3,4,5,7) / 영화 데이터 통계(Task 3,8) / 허브 버튼 3종(Task 8) / movie_list 정리(Task 9) / 로그인 리다이렉트+proxy 가드(Task 10) / 테스트(Task 2,3,11) 모두 매핑됨.
- **타입 일관성:** FE `Stats` 인터페이스 = BE `/api/stats` 응답(`visitors{total,month,week,day}`, `movies{total,with_graph,without_graph}`)과 일치. backfill 이벤트 형태(`progress`/`done`)는 기존 movie_list 구현과 동일하게 이전.
- **Placeholder:** 없음. 스코어링 버튼은 의도된 비활성 placeholder(스펙 비목표).
