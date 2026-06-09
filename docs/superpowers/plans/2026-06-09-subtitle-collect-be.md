# 자막 수집 4K_BE 이동 + 매니저 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** subdl 자막 수집을 4K_BE로 옮겨, 매니저 페이지 "자막 데이터 수집" 버튼이 자막 없는 영화를 최대 100편 수집하며 진행 바를 실시간 표시하게 한다.

**Architecture:** `4K_BE/app/subtitle_collect.py`에 `backfill_popular.py`와 동일한 async 제너레이터(`collect_events`)+NDJSON 스트리밍 패턴. BE 엔드포인트 `POST /api/subtitles/collect` → FE 프록시 → 매니저 버튼. vm4 movies에서 vm5 `processing_status`가 done 아닌 영화만 대상. 4K_ML/subtitle_fetch는 제거.

**Tech Stack:** FastAPI, httpx(async), zipfile, pytest(asyncio_mode=auto). Next.js 16(FE 프록시·버튼).

**Spec:** `docs/superpowers/specs/2026-06-09-subtitle-collect-be-design.md`

**작업 디렉터리:** BE는 `4K_BE/`, FE는 `4K_FE/`. 커밋은 리포 루트.

---

## File Structure

- Create: `4K_BE/app/subtitle_collect.py` — subdl 수집 로직(선택·subdl·vm5 io·collect_events)
- Modify: `4K_BE/app/main.py` — `POST /api/subtitles/collect` 스트리밍 엔드포인트
- Test: `4K_BE/tests/test_subtitle_collect.py`
- Create: `4K_FE/app/api/manager/subtitles/collect/route.ts` — 스트리밍 프록시
- Modify: `4K_FE/app/manager/page.tsx` — "자막 데이터 수집" 버튼 + 진행 배너(스트림 소비 공통화)
- Delete: `4K_ML/subtitle_fetch/` + 관련 테스트(`tests/test_select.py`, `test_subdl_client.py`, `test_subtitle_db.py`, `test_fetch_subtitles.py`)

---

## Task 1: BE subtitle_collect — 순수 헬퍼 (선택·srt추출·설정)

**Files:**
- Create: `4K_BE/app/subtitle_collect.py`
- Test: `4K_BE/tests/test_subtitle_collect.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`4K_BE/tests/test_subtitle_collect.py`:

```python
import io
import zipfile

import pytest

from app import subtitle_collect as sc


def test_choose_prefers_sdh():
    c = [{"url": "/a.zip", "hi": 0}, {"url": "/b.zip", "hi": 1}]
    assert sc.choose(c)["url"] == "/b.zip"


def test_choose_filters_non_english():
    assert sc.choose([{"url": "/a.zip", "hi": 1, "language": "FR", "lang": "french"}]) is None


def test_choose_fallback_to_non_sdh():
    assert sc.choose([{"url": "/a.zip", "hi": 0}])["url"] == "/a.zip"


def test_choose_skips_full_season():
    assert sc.choose([{"url": "/a.zip", "hi": 1, "full_season": True}]) is None


def test_choose_empty_returns_none():
    assert sc.choose([]) is None


def test_largest_srt_picks_biggest():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("small.srt", "short")
        z.writestr("big.srt", "x" * 100)
        z.writestr("readme.txt", "ignore")
    assert sc._largest_srt(buf.getvalue()) == "x" * 100


def test_largest_srt_no_srt_raises():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("a.txt", "x")
    with pytest.raises(ValueError):
        sc._largest_srt(buf.getvalue())


def test_config_from_env_defaults(monkeypatch):
    monkeypatch.delenv("SUBTITLE_MAX_NEW", raising=False)
    monkeypatch.delenv("SUBTITLE_RATE_DELAY", raising=False)
    assert sc.config_from_env() == (100, 0.5)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_BE && python -m pytest tests/test_subtitle_collect.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.subtitle_collect'`

- [ ] **Step 3: 모듈 생성 (순수 부분)**

`4K_BE/app/subtitle_collect.py`:

```python
"""subdl 자막 수집 — 매니저 버튼/스트리밍과 (추후)CronJob이 공유.

핵심 로직은 `collect_events` async 제너레이터에 있고 진행 이벤트를 yield한다.
vm4 movies에서 vm5 processing_status가 done 아닌 영화만 골라 자막을 수집한다.
"""
import io
import os
import zipfile


SUBDL_API = "https://api.subdl.com/api/v1/subtitles"
SUBDL_DL = "https://dl.subdl.com"


class SubdlRateLimit(Exception):
    """subdl 일일 한도 초과/429."""


def config_from_env() -> tuple[int, float]:
    """(max_new, rate_delay) — 버튼 1회 수집량과 요청 간 지연."""
    return (
        int(os.getenv("SUBTITLE_MAX_NEW", "100")),
        float(os.getenv("SUBTITLE_RATE_DELAY", "0.5")),
    )


# ── 선택 로직 (순수) ──────────────────────────────────────────────

def is_sdh(c: dict) -> bool:
    return bool(c.get("hi"))


def _is_full_season(c: dict) -> bool:
    return bool(c.get("full_season"))


def _is_english(c: dict) -> bool:
    lang = (c.get("language") or c.get("lang") or "").lower()
    return lang in ("", "en", "english")


def choose(candidates: list[dict]) -> dict | None:
    """영어·단편 필터 → SDH 우선 → subdl 반환순 1등. 없으면 None.
    (subdl 검색은 format 미제공·name이 .zip이라 srt 필터는 안 함 — srt는 추출 단계 보장.)"""
    eligible = [c for c in candidates if _is_english(c) and not _is_full_season(c)]
    if not eligible:
        return None
    sdh = [c for c in eligible if is_sdh(c)]
    return (sdh or eligible)[0]


def _largest_srt(zip_bytes: bytes) -> str:
    """zip에서 가장 큰 .srt 텍스트(utf-8, 실패 시 latin-1)."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        srts = [n for n in z.namelist() if n.lower().endswith(".srt")]
        if not srts:
            raise ValueError("zip에 .srt 파일이 없음")
        biggest = max(srts, key=lambda n: z.getinfo(n).file_size)
        raw = z.read(biggest)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_BE && python -m pytest tests/test_subtitle_collect.py -q`
Expected: PASS (8 passed)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/subtitle_collect.py 4K_BE/tests/test_subtitle_collect.py
git commit -m "feat(be): subtitle_collect 순수 헬퍼(choose/srt추출/config) + 테스트"
```

---

## Task 2: BE subtitle_collect — async subdl + vm5 io + collect_events

**Files:**
- Modify: `4K_BE/app/subtitle_collect.py`
- Test: `4K_BE/tests/test_subtitle_collect.py`

- [ ] **Step 1: 실패하는 테스트 추가**

`4K_BE/tests/test_subtitle_collect.py` 끝에 추가:

```python
import httpx


def _zip_bytes(text: str = "1\n00:00:01,000 --> 00:00:02,000\nHi\n") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("movie.srt", text)
    return buf.getvalue()


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_search_parses_and_ratelimit(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")

    async def ok():
        client = _client(lambda req: httpx.Response(
            200, json={"status": True, "subtitles": [{"url": "/a.zip", "hi": 1}]}))
        return await sc.search(client, 27205)

    out = await ok()
    assert out[0]["url"] == "/a.zip"

    client = _client(lambda req: httpx.Response(429, json={}))
    with pytest.raises(sc.SubdlRateLimit):
        await sc.search(client, 1)


async def test_download_and_extract(monkeypatch):
    zb = _zip_bytes()
    client = _client(lambda req: httpx.Response(200, content=zb))
    text = await sc.download_and_extract(client, "/subtitle/1-2.zip")
    assert "Hi" in text


async def test_collect_events_happy(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("DATA_SUPABASE_URL", "https://data.test")
    monkeypatch.setenv("DATA_SUPABASE_KEY", "k")
    zb = _zip_bytes()

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 100}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[])           # done 없음
        if "api.subdl.com" in u:
            return httpx.Response(200, json={"status": True,
                "subtitles": [{"url": "/s.zip", "release_name": "R", "hi": True, "language": "EN"}]})
        if "dl.subdl.com" in u:
            return httpx.Response(200, content=zb)
        if "ai.test/rest/v1/subtitles" in u and req.method == "POST":
            return httpx.Response(201, json=[])
        if "ai.test/rest/v1/processing_status" in u and req.method == "POST":
            return httpx.Response(201, json=[])
        return httpx.Response(404)

    client = _client(handler)
    events = [ev async for ev in sc.collect_events(client, max_new=100, rate_delay=0)]
    assert events[-1]["type"] == "done"
    assert events[-1]["added"] == 1
    assert any(e["type"] == "progress" for e in events)


async def test_collect_events_skips_done(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("DATA_SUPABASE_URL", "https://data.test")
    monkeypatch.setenv("DATA_SUPABASE_KEY", "k")

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 100}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[{"tmdb_id": 100}])  # 이미 done
        return httpx.Response(500)  # subdl/저장 호출되면 안 됨

    client = _client(handler)
    events = [ev async for ev in sc.collect_events(client, max_new=100, rate_delay=0)]
    assert events == [{"type": "done", "added": 0, "skipped": 0, "failed": []}]


async def test_collect_events_respects_max_new(monkeypatch):
    monkeypatch.setenv("SUBDL_API_KEY", "k")
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("DATA_SUPABASE_URL", "https://data.test")
    monkeypatch.setenv("DATA_SUPABASE_KEY", "k")
    zb = _zip_bytes()

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 1}, {"tmdb_id": 2}, {"tmdb_id": 3}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[])
        if "api.subdl.com" in u:
            return httpx.Response(200, json={"status": True,
                "subtitles": [{"url": "/s.zip", "hi": True, "language": "EN"}]})
        if "dl.subdl.com" in u:
            return httpx.Response(200, content=zb)
        return httpx.Response(201, json=[])

    client = _client(handler)
    events = [ev async for ev in sc.collect_events(client, max_new=2, rate_delay=0)]
    assert events[-1]["added"] == 2
    assert sum(1 for e in events if e["type"] == "progress") == 2
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd 4K_BE && python -m pytest tests/test_subtitle_collect.py -q`
Expected: FAIL — `AttributeError: module 'app.subtitle_collect' has no attribute 'search'`

- [ ] **Step 3: async subdl + vm5 io + collect_events 추가**

`4K_BE/app/subtitle_collect.py` 끝에 추가:

```python
import asyncio
from datetime import datetime, timezone

import httpx

from app import tmdb_common as tc


def _subdl_key() -> str:
    key = os.getenv("SUBDL_API_KEY", "")
    if not key:
        raise RuntimeError("SUBDL_API_KEY 환경변수가 필요합니다.")
    return key


# ── vm5(ai) REST 접근 ─────────────────────────────────────────────

def ai_url() -> str:
    return os.getenv("AI_DATABASE_URL", "")


def _ai_key() -> str:
    return os.getenv("AI_DATABASE_KEY", "")


def _ai_auth():
    user = os.getenv("AI_BASIC_USER")
    return (user, os.getenv("AI_BASIC_PASS", "")) if user else None


def ai_headers(write: bool = False) -> dict:
    key = _ai_key()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if write:
        h["Content-Type"] = "application/json"
        h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    return h


# ── subdl (async) ─────────────────────────────────────────────────

async def search(client: httpx.AsyncClient, tmdb_id: int) -> list[dict]:
    r = await client.get(SUBDL_API, params={
        "api_key": _subdl_key(), "tmdb_id": tmdb_id, "type": "movie",
        "languages": "EN", "subs_per_page": 30, "hi": 1, "releases": 1,
    })
    if r.status_code == 429:
        raise SubdlRateLimit("subdl 429")
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("status") is False:
        msg = str(data.get("error", "")).lower()
        if "limit" in msg or "quota" in msg:
            raise SubdlRateLimit(msg)
        return []
    return data.get("subtitles", []) if isinstance(data, dict) else []


async def download_and_extract(client: httpx.AsyncClient, url_path: str) -> str:
    url = url_path if url_path.startswith("http") else f"{SUBDL_DL}{url_path}"
    r = await client.get(url)
    if r.status_code == 429:
        raise SubdlRateLimit("subdl download 429")
    r.raise_for_status()
    return _largest_srt(r.content)


# ── vm5 io ────────────────────────────────────────────────────────

async def get_done_ids(client: httpx.AsyncClient) -> set[int]:
    r = await client.get(
        f"{ai_url()}/rest/v1/processing_status",
        params={"select": "tmdb_id", "subtitle_state": "eq.done", "limit": "100000"},
        headers=ai_headers(), auth=_ai_auth(),
    )
    if r.status_code != 200:
        return set()
    return {row["tmdb_id"] for row in r.json()}


async def save_subtitle(client: httpx.AsyncClient, tmdb_id: int, chosen: dict, raw_text: str) -> None:
    row = {
        "tmdb_id": tmdb_id, "language": "en", "provider": "subdl",
        "provider_file_id": str(chosen.get("url") or ""),
        "release_name": chosen.get("release_name"),
        "is_sdh": bool(chosen.get("hi")), "raw_text": raw_text,
    }
    r = await client.post(f"{ai_url()}/rest/v1/subtitles",
                          params={"on_conflict": "tmdb_id"}, json=[row],
                          headers=ai_headers(write=True), auth=_ai_auth())
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"subtitles upsert 실패 {r.status_code}: {r.text[:200]}")


async def set_status(client: httpx.AsyncClient, tmdb_id: int, state: str, error: str | None = None) -> None:
    row = {"tmdb_id": tmdb_id, "subtitle_state": state, "error": error,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    r = await client.post(f"{ai_url()}/rest/v1/processing_status",
                          params={"on_conflict": "tmdb_id"}, json=[row],
                          headers=ai_headers(write=True), auth=_ai_auth())
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"status upsert 실패 {r.status_code}: {r.text[:200]}")


# ── 이벤트 제너레이터 ─────────────────────────────────────────────

async def collect_events(client: httpx.AsyncClient, max_new: int, rate_delay: float):
    """vm4 movies 중 vm5에서 done 아닌 영화를 최대 max_new편 수집하며 진행 이벤트 yield.

    {"type":"progress","processed":int,"target":int,"title":str|None}
    {"type":"done","added":int,"skipped":int,"failed":list[int]}
    processed = 시도한(자막 없던) 영화 누적. SubdlRateLimit 시 done으로 마무리.
    """
    movie_ids = sorted(await tc.get_existing_tmdb_ids(client))
    done = await get_done_ids(client)
    processed = 0
    added = 0
    skipped = 0
    failed: list[int] = []

    for tmdb_id in movie_ids:
        if processed >= max_new:
            break
        if tmdb_id in done:
            continue
        title = None
        try:
            chosen = choose(await search(client, tmdb_id))
            if chosen is None:
                await set_status(client, tmdb_id, "skipped")
                skipped += 1
            else:
                title = chosen.get("release_name")
                raw = await download_and_extract(client, chosen.get("url") or "")
                if not raw.strip():
                    await set_status(client, tmdb_id, "failed", "empty srt")
                    failed.append(tmdb_id)
                else:
                    await save_subtitle(client, tmdb_id, chosen, raw)
                    await set_status(client, tmdb_id, "done")
                    added += 1
        except SubdlRateLimit:
            break
        except Exception as e:  # noqa: BLE001
            await set_status(client, tmdb_id, "failed", str(e)[:500])
            failed.append(tmdb_id)
        processed += 1
        yield {"type": "progress", "processed": processed, "target": max_new, "title": title}
        if rate_delay:
            await asyncio.sleep(rate_delay)

    yield {"type": "done", "added": added, "skipped": skipped, "failed": failed}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd 4K_BE && python -m pytest tests/test_subtitle_collect.py -q`
Expected: PASS (13 passed)

- [ ] **Step 5: 회귀 확인**

Run: `cd 4K_BE && python -m pytest -q`
Expected: 기존 포함 전부 PASS

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/subtitle_collect.py 4K_BE/tests/test_subtitle_collect.py
git commit -m "feat(be): subtitle_collect async subdl/vm5 io/collect_events + 테스트"
```

---

## Task 3: BE 엔드포인트 POST /api/subtitles/collect

**Files:**
- Modify: `4K_BE/app/main.py`

- [ ] **Step 1: import 추가**

`4K_BE/app/main.py`의 `from app import backfill_popular as bf` 다음 줄에 추가:

```python
from app import subtitle_collect as sc
```

- [ ] **Step 2: 엔드포인트 추가**

`backfill_now` 함수(`@app.post("/api/movies/backfill")`) 바로 아래에 추가:

```python
@app.post("/api/subtitles/collect")
async def subtitles_collect():
    """매니저 '자막 데이터 수집' — 자막 없는 영화를 최대 max_new편 수집하며
    진행 상황을 NDJSON 스트림으로 흘려보낸다."""
    max_new, rate_delay = sc.config_from_env()

    async def stream():
        async with httpx.AsyncClient(timeout=60, verify=False) as client:
            async for ev in sc.collect_events(client, max_new, rate_delay):
                yield json.dumps(ev, ensure_ascii=False) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
```

- [ ] **Step 3: 임포트 동작 확인**

Run: `cd 4K_BE && python -c "from app import main; print('ok')"`
Expected: `ok`

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_BE/app/main.py
git commit -m "feat(be): POST /api/subtitles/collect 스트리밍 엔드포인트"
```

---

## Task 4: FE 스트리밍 프록시 라우트

**Files:**
- Create: `4K_FE/app/api/manager/subtitles/collect/route.ts`

- [ ] **Step 1: 라우트 작성** (`app/api/manager/movies/backfill/route.ts` 미러)

`4K_FE/app/api/manager/subtitles/collect/route.ts`:

```typescript
// 매니저 '자막 데이터 수집' — BE collect를 트리거하고 NDJSON 진행 스트림을 그대로 전달.
export const dynamic = 'force-dynamic';

const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST() {
  const res = await fetch(`${BE_URL}/api/subtitles/collect`, { method: 'POST' });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
    },
  });
}
```

- [ ] **Step 2: 린트 확인**

Run: `cd 4K_FE && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/api/manager/subtitles/collect/route.ts
git commit -m "feat(fe): /api/manager/subtitles/collect 스트리밍 프록시"
```

---

## Task 5: FE 매니저 "자막 데이터 수집" 버튼 + 진행 배너

**Files:**
- Modify: `4K_FE/app/manager/page.tsx`

스트림 소비 로직을 공통 헬퍼로 추출하고 backfill·collect 두 잡이 같은 배너 컴포넌트를 쓰도록 정리한다(중복 제거).

- [ ] **Step 1: Job 타입 + 공통 스트림 헬퍼 + 배너 컴포넌트 추가**

`app/manager/page.tsx`에서 `interface Stats { ... }` 바로 아래에 추가:

```tsx
interface Job {
  running: boolean;
  processed: number;
  target: number;
  title: string | null;
  done: { added: number; failed: number } | null;
}

// NDJSON 진행 스트림 소비 — backfill·collect 공통
async function streamJob(
  endpoint: string,
  setJob: React.Dispatch<React.SetStateAction<Job | null>>,
  onComplete?: () => void,
) {
  setJob({ running: true, processed: 0, target: 100, title: null, done: null });
  try {
    const res = await fetch(endpoint, { method: 'POST' });
    if (!res.ok || !res.body) throw new Error('시작 실패');
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
          setJob((s) => (s ? { ...s, processed: ev.processed, target: ev.target, title: ev.title } : s));
        } else if (ev.type === 'done') {
          doneEv = { added: ev.added, failed: (ev.failed ?? []).length };
        }
      }
    }
    setJob((s) => (s ? { ...s, running: false, done: doneEv ?? { added: 0, failed: 0 } } : s));
    onComplete?.();
  } catch {
    setJob((s) => (s ? { ...s, running: false, done: { added: 0, failed: 0 } } : s));
  }
}

function JobBanner({ job, label, onClose }: { job: Job; label: string; onClose: () => void }) {
  const pct = Math.min(100, Math.round(
    ((job.running ? job.processed : job.done?.added ?? 0) / Math.max(1, job.target)) * 100));
  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
          {job.running
            ? `${label} 중… ${job.processed} / ${job.target}${job.title ? ` — ${job.title}` : ''}`
            : `완료 — 신규 ${job.done?.added ?? 0}개${job.done?.failed ? `, 실패 ${job.done.failed}개` : ''}`}
        </span>
        {!job.running && (
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            닫기
          </button>
        )}
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`,
          background: job.running ? 'var(--accent)' : 'rgba(34,197,94,0.85)', transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: collect 상태 추가 + runBackfill/runCollect를 헬퍼로 정리**

`const [backfill, setBackfill] = useState<{ ... } | null>(null);` 블록(주석 포함, 16~23행)을 다음으로 교체:

```tsx
  // backfill(신규 100개 추가) / collect(자막 데이터 수집) 진행 상태
  const [backfill, setBackfill] = useState<Job | null>(null);
  const [collect, setCollect] = useState<Job | null>(null);
```

그리고 기존 `runBackfill` 함수 전체(`// 신규 100개 수동 추가 ...`부터 `};`까지)를 다음으로 교체:

```tsx
  // 신규 100개 수동 추가 — backfill 스트림 소비
  const runBackfill = () => {
    if (backfill?.running) return;
    streamJob('/api/manager/movies/backfill', setBackfill, fetchStats);
  };

  // 자막 데이터 수집 — 자막 없는 영화 최대 100편, collect 스트림 소비
  const runCollect = () => {
    if (collect?.running) return;
    streamJob('/api/manager/subtitles/collect', setCollect, fetchStats);
  };
```

- [ ] **Step 3: 버튼 추가**

기능 버튼 섹션에서 "영화 데이터 스코어링" 버튼 바로 앞에 자막 수집 버튼을 추가. 다음을 찾고:

```tsx
            <button
              disabled
              title="추후 개발된 모델로 동작 예정"
              style={{ ...actionBtn(true), cursor: 'not-allowed' }}
            >
              영화 데이터 스코어링 (준비 중)
            </button>
```

그 앞에 삽입:

```tsx
            <button onClick={runCollect} disabled={collect?.running} style={actionBtn(!!collect?.running)}>
              {collect?.running ? '수집 중…' : '자막 데이터 수집'}
            </button>
```

- [ ] **Step 4: 배너 교체 — backfill 배너를 공통 컴포넌트로, collect 배너 추가**

기존 backfill 진행 배너 블록(`{/* Backfill 진행 배너 */}` 또는 `{backfill && (` 으로 시작하는 전체 블록)을 다음으로 교체:

```tsx
        {/* 진행 배너 (backfill / collect) */}
        {backfill && <JobBanner job={backfill} label="신규 영화 추가" onClose={() => setBackfill(null)} />}
        {collect && <JobBanner job={collect} label="자막 수집" onClose={() => setCollect(null)} />}
```

- [ ] **Step 5: 빌드 검증**

Run: `cd 4K_FE && npm run build`
Expected: 성공 (타입 에러 없음). 실패 시 Job 타입/streamJob 위치 확인.

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_FE/app/manager/page.tsx
git commit -m "feat(fe): 매니저 '자막 데이터 수집' 버튼 + 진행 배너(스트림 소비 공통화)"
```

---

## Task 6: 4K_ML/subtitle_fetch 제거

**Files:**
- Delete: `4K_ML/subtitle_fetch/`, `4K_ML/tests/test_select.py`, `test_subdl_client.py`, `test_subtitle_db.py`, `test_fetch_subtitles.py`

- [ ] **Step 1: 삭제**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML
rm -rf subtitle_fetch tests/test_select.py tests/test_subdl_client.py tests/test_subtitle_db.py tests/test_fetch_subtitles.py
```

- [ ] **Step 2: 남은 ML 테스트 확인 (스키마 테스트만 남음)**

Run: `cd 4K_ML && .venv/bin/python -m pytest -q`
Expected: `test_schema.py`만 수집 — 3 skipped(로컬 PG 없음) 또는 통과. import 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add -A 4K_ML/subtitle_fetch 4K_ML/tests
git commit -m "refactor(ml): subtitle_fetch 제거 — 자막 수집을 4K_BE로 이동"
```

---

## Task 7: 배포 env + 라이브 검증 (운영 핸드오프)

**Files:** (없음 — 운영/검증)

- [ ] **Step 1: BE에 vm5/subdl env 주입**

4K_BE 배포(매니페스트/시크릿)에 추가: `SUBDL_API_KEY`, `AI_DATABASE_URL=https://ai.peakly.art`, `AI_DATABASE_KEY`(ai service_role). 로컬 테스트는 `4K_BE/.env`에 동일 추가.
(BE→vm5 REST는 basic auth 불필요 — `supabase-ai-api` 인그레스. 클러스터 내부면 내부 kong 주소도 가능.)

- [ ] **Step 2: BE 로컬 기동 + 엔드포인트 스모크**

```bash
cd 4K_BE && set -a; source .env; set +a
.venv/bin/uvicorn app.main:app --port 8000 &
curl -s -N -X POST http://localhost:8000/api/subtitles/collect | head -5
```
Expected: NDJSON 진행 줄(`{"type":"progress",...}`)이 흐르다 `{"type":"done",...}`. (SUBTITLE_MAX_NEW를 5로 낮춰 시범: `SUBTITLE_MAX_NEW=5`.)

- [ ] **Step 3: 매니저 페이지에서 버튼 동작 확인**

FE/BE 배포 후 `/manager` → "자막 데이터 수집" 클릭 → 진행 바가 `수집 중… N/100 — 제목`으로 갱신되고 완료 시 "완료 — 신규 N개" + 영화 데이터 카드(그래프 없음/전체) 수치는 자막과 무관하므로 변화 없을 수 있음(정상).

- [ ] **Step 4: vm5 적재 확인**

```bash
curl -s "https://ai.peakly.art/rest/v1/processing_status?select=subtitle_state" -H "apikey: $AI_DATABASE_KEY"
curl -s "https://ai.peakly.art/rest/v1/subtitles?select=tmdb_id,is_sdh&limit=5" -H "apikey: $AI_DATABASE_KEY"
```
Expected: done/skipped 분포, subtitles 행 존재.

---

## Self-Review 메모

- **Spec 커버리지:** subtitle_collect(choose/srt/subdl/vm5 io/collect_events) Task1·2 / 엔드포인트 Task3 / FE 프록시 Task4 / 버튼·배너 Task5 / subtitle_fetch 제거 Task6 / env·라이브 Task7. 선택규칙·상태의미·max_new 상한·rate limit 중단·멱등(done 스킵) 모두 collect_events에 반영.
- **타입/이름 일관성:** `choose`/`is_sdh`/`_largest_srt`/`search`/`download_and_extract`/`get_done_ids`/`save_subtitle`/`set_status`/`collect_events`/`config_from_env`(BE), `Job`/`streamJob`/`JobBanner`/`runCollect`(FE) — 테스트·구현·본문 일치. 이벤트 형태 `{type,processed,target,title}`·`{type,added,skipped,failed}`가 BE·FE에서 동일.
- **Placeholder:** 없음.
- **주의:** BE 테스트는 MockTransport로 네트워크 없이 검증. 실제 vm5/subdl/배포 검증은 Task7. asyncio_mode=auto(기존 pytest.ini)라 async 테스트가 그대로 동작.
