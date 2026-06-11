# 데이터 수집 자동화 + 매니저 수동 수집 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영화/자막 수집을 매일 300편씩 자동화(크론)하고, 매니저 수동 수집을 백그라운드 잡 + 폴링으로 바꿔 임의 수량을 진행도·로그·에러와 함께 수집한다.

**Architecture:** 수집 로직(`backfill_events`/`collect_events`)은 공유. 크론은 헤드리스 CLI로 소비(stdout), 수동은 BE 인메모리 잡 레지스트리(`jobs.py`)에 비동기 태스크로 소비하고 FE가 `GET /api/jobs/{type}`를 폴링. 데이터는 모든 경로에서 DB에 즉시 멱등 커밋.

**Tech Stack:** FastAPI, httpx(async), pytest+pytest-asyncio, Kustomize/CronJob, Next.js 16(App Router, async params), React.

**Spec:** `docs/superpowers/specs/2026-06-11-data-collection-automation-design.md`

**Working dir:** BE 명령은 `4K_BE/`, FE 명령은 `4K_FE/`. git은 저장소 루트. 현재 브랜치 `feat/data-collection-automation`.

---

## File Structure

| 파일 | 변경 | 책임 |
|---|---|---|
| `4K_BE/app/subtitle_collect.py` | 수정 | collect 이벤트에 tmdb_id/result/error 추가 + `run()`/`main()`/`__main__` CLI |
| `4K_BE/app/backfill_popular.py` | 수정 | backfill progress에 tmdb_id/result/error 추가 |
| `4K_BE/app/jobs.py` | 신규 | 인메모리 잡 레지스트리(start/get/_run) |
| `4K_BE/app/main.py` | 수정 | backfill/collect → fire-and-forget(jobs.start), `GET /api/jobs/{type}`, movie limit |
| `4K_BE/tests/test_subtitle_collect.py` | 수정 | 이벤트 필드 + run() 테스트 |
| `4K_BE/tests/test_jobs.py` | 신규 | 잡 레지스트리 테스트 |
| `4K_BE/tests/test_main_jobs.py` | 신규 | 엔드포인트 테스트 |
| `Ansible/manifests/4k-be/backfill-cronjob.yaml` | 수정 | MAX_NEW 300 |
| `Ansible/manifests/4k-be/subtitle-cronjob.yaml` | 신규 | 자막 크론 04시 300 |
| `Ansible/manifests/4k-be/kustomization.yaml` | 수정 | resources에 추가 |
| `4K_FE/app/api/manager/movies/backfill/route.ts` | 수정 | POST start(JSON) + limit |
| `4K_FE/app/api/manager/subtitles/collect/route.ts` | 수정 | POST start(JSON) |
| `4K_FE/app/api/manager/jobs/[type]/route.ts` | 신규 | GET 폴링 프록시 |
| `4K_FE/app/manager/page.tsx` | 수정 | 영화 수량 입력 + 폴링 패널(진행/로그/에러) |

---

## Task 1: 수집 이벤트에 tmdb_id/result/error 추가 (BE)

**Files:**
- Modify: `4K_BE/app/subtitle_collect.py` (collect_events 루프 끝부분)
- Modify: `4K_BE/app/backfill_popular.py` (progress yield)
- Test: `4K_BE/tests/test_subtitle_collect.py`

- [ ] **Step 1: collect 진행 이벤트 필드 검증 테스트 추가**

`4K_BE/tests/test_subtitle_collect.py` 끝에 추가:

```python
async def test_collect_progress_has_result_fields(monkeypatch):
    _set_env(monkeypatch)
    zb = _zip_bytes()

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 100}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[])
        if "api.subdl.com" in u:
            return httpx.Response(200, json={"status": True,
                "subtitles": [{"url": "/s.zip", "release_name": "R", "hi": True, "language": "EN"}]})
        if "dl.subdl.com" in u:
            return httpx.Response(200, content=zb)
        return httpx.Response(201, json=[])

    events = [ev async for ev in sc.collect_events(_client(handler), max_new=100, rate_delay=0)]
    prog = [e for e in events if e["type"] == "progress"]
    assert prog[0]["tmdb_id"] == 100
    assert prog[0]["result"] == "added"
    assert prog[0]["title"] == "R"
    assert "error" in prog[0]
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_subtitle_collect.py::test_collect_progress_has_result_fields -v`
Expected: FAIL (KeyError: 'tmdb_id' 또는 'result')

- [ ] **Step 3: collect_events 루프 본문 교체**

`4K_BE/app/subtitle_collect.py`에서 `for tmdb_id in movie_ids:` 루프 본문(현재 `prev_retry = ...`부터 `yield {"type": "progress", ...}`까지)을 아래로 교체:

```python
        prev_retry = (info or {}).get("retry", 0)
        title = None
        result = "skipped"
        err = None
        try:
            chosen = choose(await search(client, tmdb_id))
            if chosen is None:
                await set_status(client, tmdb_id, "skipped")
                skipped += 1
                result = "skipped"
            else:
                title = chosen.get("release_name")
                raw = await download_and_extract(client, chosen.get("url") or "")
                if not raw.strip():
                    await set_status(client, tmdb_id, "failed", "empty srt", retry_count=prev_retry + 1)
                    failed.append(tmdb_id)
                    result, err = "failed", "empty srt"
                else:
                    await save_subtitle(client, tmdb_id, chosen, raw)
                    await set_status(client, tmdb_id, "done")
                    added += 1
                    result = "added"
        except SubdlRateLimit:
            break
        except Exception as e:  # noqa: BLE001
            await set_status(client, tmdb_id, "failed", str(e)[:500], retry_count=prev_retry + 1)
            failed.append(tmdb_id)
            result, err = "failed", str(e)[:200]
        processed += 1
        yield {"type": "progress", "processed": processed, "target": max_new,
               "tmdb_id": tmdb_id, "title": title, "result": result, "error": err}
        if rate_delay:
            await asyncio.sleep(rate_delay)
```

- [ ] **Step 4: backfill progress에 필드 추가**

`4K_BE/app/backfill_popular.py`에서 progress yield(현재):
```python
                yield {"type": "progress", "processed": processed, "target": max_new,
                       "page": page, "title": movie.get("title")}
```
을 아래로 교체:
```python
                yield {"type": "progress", "processed": processed, "target": max_new,
                       "page": page, "tmdb_id": tid, "title": movie.get("title"),
                       "result": "added", "error": None}
```

- [ ] **Step 5: 통과 확인 + 회귀**

Run: `python -m pytest tests/test_subtitle_collect.py -v`
Expected: PASS (기존 + 신규 모두). 기존 collect 테스트는 progress를 정확매칭하지 않아 영향 없음.

- [ ] **Step 6: Commit**

```bash
git add 4K_BE/app/subtitle_collect.py 4K_BE/app/backfill_popular.py 4K_BE/tests/test_subtitle_collect.py
git commit -m "feat(be): 수집 progress 이벤트에 tmdb_id/result/error 추가"
```

---

## Task 2: 자막 수집 CLI 진입점 (BE)

**Files:**
- Modify: `4K_BE/app/subtitle_collect.py` (파일 끝에 run/main 추가)
- Test: `4K_BE/tests/test_subtitle_collect.py`

- [ ] **Step 1: run() 완주 테스트 추가**

`4K_BE/tests/test_subtitle_collect.py` 끝에 추가:

```python
async def test_run_collect_consumes_to_done(monkeypatch):
    _set_env(monkeypatch)
    zb = _zip_bytes()
    monkeypatch.setenv("SUBTITLE_MAX_NEW", "5")

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "data.test/rest/v1/movies" in u:
            return httpx.Response(200, json=[{"tmdb_id": 100}])
        if "ai.test/rest/v1/processing_status" in u and req.method == "GET":
            return httpx.Response(200, json=[])
        if "api.subdl.com" in u:
            return httpx.Response(200, json={"status": True,
                "subtitles": [{"url": "/s.zip", "release_name": "R", "hi": True, "language": "EN"}]})
        if "dl.subdl.com" in u:
            return httpx.Response(200, content=zb)
        return httpx.Response(201, json=[])

    summary = await sc.run(_client(handler))
    assert summary["added"] == 1
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_subtitle_collect.py::test_run_collect_consumes_to_done -v`
Expected: FAIL (AttributeError: module 'app.subtitle_collect' has no attribute 'run')

- [ ] **Step 3: run()/main()/__main__ 추가**

`4K_BE/app/subtitle_collect.py` 맨 끝(`collect_events` 정의 다음)에 추가:

```python
async def run(client: httpx.AsyncClient) -> dict:
    """collect_events를 끝까지 소비. 진행 출력 + 최종 요약 반환 (CronJob/배치 진입점)."""
    max_new, rate_delay = config_from_env()
    summary = {"added": 0, "skipped": 0, "failed": []}
    async for ev in collect_events(client, max_new, rate_delay):
        if ev["type"] == "progress":
            print(f"[subtitle] {ev['processed']}/{ev['target']} "
                  f"tmdb={ev['tmdb_id']} {ev['result']}"
                  + (f" {ev['title']}" if ev.get("title") else "")
                  + (f" — {ev['error']}" if ev.get("error") else ""))
        elif ev["type"] == "done":
            summary = {"added": ev["added"], "skipped": ev["skipped"], "failed": ev["failed"]}
    print(f"[subtitle] 완료: 신규 {summary['added']}, 스킵 {summary['skipped']}, "
          f"실패 {len(summary['failed'])}: {summary['failed']}")
    return summary


async def main() -> None:
    from dotenv import load_dotenv
    base = os.path.dirname(os.path.dirname(__file__))  # 4K_BE/
    load_dotenv(os.path.join(base, ".env"))
    async with httpx.AsyncClient(timeout=60, verify=False) as client:
        await run(client)


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_subtitle_collect.py::test_run_collect_consumes_to_done -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add 4K_BE/app/subtitle_collect.py 4K_BE/tests/test_subtitle_collect.py
git commit -m "feat(be): 자막 수집 CLI 진입점 run()/__main__ (자막 크론용)"
```

---

## Task 3: 인메모리 잡 레지스트리 (BE)

**Files:**
- Create: `4K_BE/app/jobs.py`
- Test: `4K_BE/tests/test_jobs.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_BE/tests/test_jobs.py`:

```python
import pytest

from app import jobs


@pytest.fixture(autouse=True)
def _clear():
    jobs._REGISTRY.clear()
    jobs._TASKS.clear()
    yield
    jobs._REGISTRY.clear()
    jobs._TASKS.clear()


async def _fake_ok(client):
    yield {"type": "progress", "processed": 1, "target": 2, "tmdb_id": 10,
           "title": "A", "result": "added", "error": None}
    yield {"type": "progress", "processed": 2, "target": 2, "tmdb_id": 11,
           "title": None, "result": "skipped", "error": None}
    yield {"type": "done", "added": 1, "skipped": 1, "failed": []}


async def _fake_boom(client):
    raise RuntimeError("kaboom")
    yield  # async generator로 만들기 위함(도달 안 함)


def test_get_defaults_idle():
    assert jobs.get("movie")["state"] == "idle"


async def test_start_runs_and_records():
    st = jobs.start("movie", _fake_ok)
    assert st["state"] == "running"
    await jobs._TASKS["movie"]
    final = jobs.get("movie")
    assert final["state"] == "done"
    assert final["processed"] == 2 and final["target"] == 2
    assert final["added"] == 1 and final["skipped"] == 1
    assert len(final["log"]) == 2


async def test_start_dedupes_running():
    jobs._REGISTRY["movie"] = {**jobs._idle(), "state": "running"}
    st = jobs.start("movie", _fake_ok)
    assert st["state"] == "running"
    assert "movie" not in jobs._TASKS  # 새 태스크 생성 안 함


async def test_run_captures_exception():
    jobs._REGISTRY["subtitle"] = {**jobs._idle(), "state": "running", "started_at": jobs._now()}
    await jobs._run("subtitle", _fake_boom)
    st = jobs.get("subtitle")
    assert st["state"] == "failed"
    assert "kaboom" in st["error"]
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_jobs.py -v`
Expected: FAIL (ModuleNotFoundError: No module named 'app.jobs')

- [ ] **Step 3: 구현**

`4K_BE/app/jobs.py`:

```python
"""매니저 수동 수집용 인메모리 잡 레지스트리 (타입별 활성 잡 1건).

수집 데이터는 DB에 즉시 커밋되므로 이 레지스트리는 표시용 상태만 보관한다.
factory(client) -> 이벤트 async iterator (progress/done) 를 받아 백그라운드 소비한다.
"""
import asyncio
from datetime import datetime, timezone

import httpx

LOG_CAP = 500

_REGISTRY: dict[str, dict] = {}
_TASKS: dict[str, asyncio.Task] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _idle() -> dict:
    return {"state": "idle", "processed": 0, "target": 0, "added": 0,
            "skipped": 0, "failed": [], "log": [], "error": None,
            "started_at": None, "finished_at": None}


def get(job_type: str) -> dict:
    return _REGISTRY.get(job_type) or _idle()


def _log_line(ev: dict) -> str:
    parts = [f"[{ev.get('processed')}] {ev.get('result', 'processed')}",
             f"tmdb={ev.get('tmdb_id')}"]
    if ev.get("title"):
        parts.append(str(ev["title"]))
    if ev.get("error"):
        parts.append(f"— {ev['error']}")
    return " ".join(parts)


async def _run(job_type: str, factory) -> None:
    st = _REGISTRY[job_type]
    try:
        async with httpx.AsyncClient(timeout=60, verify=False) as client:
            async for ev in factory(client):
                if ev.get("type") == "progress":
                    st["processed"] = ev.get("processed", st["processed"])
                    st["target"] = ev.get("target", st["target"])
                    st["log"].append(_log_line(ev))
                    del st["log"][:-LOG_CAP]
                elif ev.get("type") == "done":
                    st["added"] = ev.get("added", 0)
                    st["skipped"] = ev.get("skipped", 0)
                    st["failed"] = ev.get("failed", [])
        st["state"] = "done"
    except Exception as e:  # noqa: BLE001
        st["state"] = "failed"
        st["error"] = str(e)[:500]
    finally:
        st["finished_at"] = _now()


def start(job_type: str, factory) -> dict:
    cur = _REGISTRY.get(job_type)
    if cur and cur["state"] == "running":
        return cur
    st = _idle()
    st["state"] = "running"
    st["started_at"] = _now()
    _REGISTRY[job_type] = st
    _TASKS[job_type] = asyncio.create_task(_run(job_type, factory))
    return st
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_jobs.py -v`
Expected: PASS (5개)

- [ ] **Step 5: Commit**

```bash
git add 4K_BE/app/jobs.py 4K_BE/tests/test_jobs.py
git commit -m "feat(be): 인메모리 잡 레지스트리(start/get/_run)"
```

---

## Task 4: 엔드포인트 전환 (BE)

**Files:**
- Modify: `4K_BE/app/main.py` (backfill_now, subtitles_collect 교체 + job_status 추가)
- Test: `4K_BE/tests/test_main_jobs.py`

- [ ] **Step 1: 엔드포인트 테스트 작성**

`4K_BE/tests/test_main_jobs.py`:

```python
from fastapi.testclient import TestClient

from app import main, jobs


def _no_real_task(monkeypatch):
    """jobs.start를 가짜로 — 실제 백그라운드 태스크/HTTP 없이 호출 인자만 기록."""
    calls = {}

    def fake_start(job_type, factory):
        calls["job_type"] = job_type
        calls["factory"] = factory
        return {**jobs._idle(), "state": "running"}

    monkeypatch.setattr(main.jobs, "start", fake_start)
    return calls


def test_backfill_starts_movie_job_with_limit(monkeypatch):
    calls = _no_real_task(monkeypatch)
    client = TestClient(main.app)
    r = client.post("/api/movies/backfill?limit=300")
    assert r.status_code == 200
    assert r.json()["state"] == "running"
    assert calls["job_type"] == "movie"


def test_collect_starts_subtitle_job(monkeypatch):
    calls = _no_real_task(monkeypatch)
    client = TestClient(main.app)
    r = client.post("/api/subtitles/collect?limit=50")
    assert r.status_code == 200
    assert calls["job_type"] == "subtitle"


def test_job_status_returns_state(monkeypatch):
    monkeypatch.setattr(main.jobs, "get", lambda t: {**jobs._idle(), "state": "done", "added": 7})
    client = TestClient(main.app)
    r = client.get("/api/jobs/movie")
    assert r.status_code == 200
    assert r.json()["added"] == 7
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_main_jobs.py -v`
Expected: FAIL (`/api/jobs/movie` 404, 또는 main에 jobs 미import)

- [ ] **Step 3: main.py 수정**

`4K_BE/app/main.py` 상단 import 블록(`from app import backfill_popular as bf` 근처)에 추가:
```python
from app import jobs
```

`backfill_now`(현재 `@app.post("/api/movies/backfill")` 함수 전체)를 교체:
```python
@app.post("/api/movies/backfill")
async def backfill_now(limit: int | None = None):
    """매니저 영화 수집 — 백그라운드 잡 시작, 즉시 잡 상태 반환. limit=수량(미지정 시 env)."""
    default_max, max_pages, rate_delay = bf.config_from_env()
    max_new = default_max if limit is None else max(1, min(limit, 2000))
    return jobs.start("movie", lambda client: bf.backfill_events(client, max_new, max_pages, rate_delay))
```

`subtitles_collect`(현재 `@app.post("/api/subtitles/collect")` 함수 전체)를 교체:
```python
@app.post("/api/subtitles/collect")
async def subtitles_collect(limit: int | None = None):
    """매니저 자막 수집 — 백그라운드 잡 시작, 즉시 잡 상태 반환. limit=수량(미지정 시 env)."""
    default_max, rate_delay = sc.config_from_env()
    max_new = default_max if limit is None else max(1, min(limit, 2000))
    return jobs.start("subtitle", lambda client: sc.collect_events(client, max_new, rate_delay))
```

`subtitles_remaining` 위(또는 아래 적당한 위치)에 신규 엔드포인트 추가:
```python
@app.get("/api/jobs/{job_type}")
async def job_status(job_type: str):
    """매니저 폴링용 — 수동 수집 잡의 진행도/로그/에러."""
    return jobs.get(job_type)
```

(StreamingResponse import가 다른 곳에서 안 쓰이면 제거 가능하나, 남겨둬도 무방.)

- [ ] **Step 4: 통과 확인 + 전체 BE 회귀**

Run: `python -m pytest -q`
Expected: 전체 PASS

- [ ] **Step 5: Commit**

```bash
git add 4K_BE/app/main.py 4K_BE/tests/test_main_jobs.py
git commit -m "feat(be): 수집 엔드포인트 fire-and-forget 전환 + GET /api/jobs/{type}"
```

---

## Task 5: 크론 매니페스트 (300x2)

**Files:**
- Modify: `Ansible/manifests/4k-be/backfill-cronjob.yaml`
- Create: `Ansible/manifests/4k-be/subtitle-cronjob.yaml`
- Modify: `Ansible/manifests/4k-be/kustomization.yaml`

- [ ] **Step 1: 영화 크론 100→300**

`Ansible/manifests/4k-be/backfill-cronjob.yaml`에서:
```yaml
                - name: BACKFILL_MAX_NEW
                  value: "100"
```
을:
```yaml
                - name: BACKFILL_MAX_NEW
                  value: "300"
```

- [ ] **Step 2: 자막 크론 신규 작성**

`Ansible/manifests/4k-be/subtitle-cronjob.yaml`:
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: subtitle-collect
  namespace: be
spec:
  schedule: "0 19 * * *"          # UTC 19:00 = KST 04:00
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          nodeSelector:
            workload: app
          containers:
            - name: subtitle-collect
              image: ghcr.io/sanggyoon/4k-be:latest
              command: ["python", "-m", "app.subtitle_collect"]
              envFrom:
                - secretRef:
                    name: 4k-be-secrets
              env:
                - name: SUBTITLE_MAX_NEW
                  value: "300"
              resources:
                requests:
                  cpu: 100m
                  memory: 128Mi
                limits:
                  cpu: 300m
                  memory: 256Mi
```

- [ ] **Step 3: kustomization resources 추가**

`Ansible/manifests/4k-be/kustomization.yaml`의 `resources:` 목록에 한 줄 추가:
```yaml
  - backfill-cronjob.yaml
  - subtitle-cronjob.yaml
```
(`images.newTag`가 모든 매니페스트 이미지를 덮으므로 cronjob의 `:latest`는 그대로 둠.)

- [ ] **Step 4: YAML 검증**

Run (저장소 루트):
```bash
python -c "import yaml; yaml.safe_load(open('Ansible/manifests/4k-be/subtitle-cronjob.yaml')); yaml.safe_load(open('Ansible/manifests/4k-be/kustomization.yaml')); print('yaml ok')"
```
Expected: `yaml ok`

- [ ] **Step 5: Commit**

```bash
git add Ansible/manifests/4k-be/backfill-cronjob.yaml Ansible/manifests/4k-be/subtitle-cronjob.yaml Ansible/manifests/4k-be/kustomization.yaml
git commit -m "feat(ops): 영화 크론 300 + 자막 크론(04시 300) 신규"
```

---

## Task 6: FE 프록시 라우트 (폴링 전환)

**Files:**
- Modify: `4K_FE/app/api/manager/movies/backfill/route.ts`
- Modify: `4K_FE/app/api/manager/subtitles/collect/route.ts`
- Create: `4K_FE/app/api/manager/jobs/[type]/route.ts`

- [ ] **Step 1: backfill 라우트 — JSON start + limit 전달**

`4K_FE/app/api/manager/movies/backfill/route.ts` 전체 교체:
```ts
// 매니저 영화 수집 — BE 백그라운드 잡 시작(JSON 반환). 진행은 /api/manager/jobs/movie 폴링.
export const dynamic = 'force-dynamic';

const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST(request: Request) {
  const limit = new URL(request.url).searchParams.get('limit');
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
  const res = await fetch(`${BE_URL}/api/movies/backfill${qs}`, { method: 'POST' });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 2: collect 라우트 — JSON start**

`4K_FE/app/api/manager/subtitles/collect/route.ts` 전체 교체:
```ts
// 매니저 자막 수집 — BE 백그라운드 잡 시작(JSON 반환). 진행은 /api/manager/jobs/subtitle 폴링.
export const dynamic = 'force-dynamic';

const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function POST(request: Request) {
  const limit = new URL(request.url).searchParams.get('limit');
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
  const res = await fetch(`${BE_URL}/api/subtitles/collect${qs}`, { method: 'POST' });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 3: jobs 폴링 라우트 신규**

`4K_FE/app/api/manager/jobs/[type]/route.ts`:
```ts
// 매니저 폴링 프록시 — BE GET /api/jobs/{type} 전달. (Next 16: params는 Promise)
export const dynamic = 'force-dynamic';

const BE_URL = process.env.BE_INTERNAL_URL ?? 'http://localhost:8000';

export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const res = await fetch(`${BE_URL}/api/jobs/${encodeURIComponent(type)}`, { cache: 'no-store' });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 4: 빌드 검증**

Run (4K_FE/): `npm run lint`
Expected: 신규/수정 파일 lint 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add 4K_FE/app/api/manager/movies/backfill/route.ts 4K_FE/app/api/manager/subtitles/collect/route.ts 4K_FE/app/api/manager/jobs/
git commit -m "feat(fe): 매니저 수집 프록시 폴링 전환 + jobs 라우트"
```

---

## Task 7: FE 매니저 페이지 (수량 입력 + 폴링 패널)

**Files:**
- Modify: `4K_FE/app/manager/page.tsx`

> FE 테스트 러너 없음 → `npm run lint` + 배포 후 수동 확인.

- [ ] **Step 1: 폴링 헬퍼로 교체**

`page.tsx`의 `streamJob` 함수(주석 "NDJSON 진행 스트림 소비" 포함 블록)를 아래 `startAndPoll`로 교체:
```tsx
// 백그라운드 잡 시작 후 상태를 폴링 — backfill·collect 공통
async function startAndPoll(
  startUrl: string,
  jobType: string,
  setJob: (j: Job) => void,
  onDone: () => void,
) {
  try {
    const res = await fetch(startUrl, { method: 'POST' });
    if (!res.ok) throw new Error(`시작 실패 (${res.status})`);
    setJob({ ...(await res.json()), running: true });
  } catch (e) {
    setJob({ state: 'failed', running: false, processed: 0, target: 0,
      added: 0, skipped: 0, failed: [], log: [], error: String(e) } as Job);
    return;
  }
  const poll = setInterval(async () => {
    try {
      const r = await fetch(`/api/manager/jobs/${jobType}`, { cache: 'no-store' });
      const data = await r.json();
      const running = data.state === 'running';
      setJob({ ...data, running });
      if (!running) {
        clearInterval(poll);
        onDone();
      }
    } catch {
      /* 폴링 일시 실패는 무시하고 다음 틱에 재시도 */
    }
  }, 1500);
}
```

- [ ] **Step 2: Job 타입 갱신**

`page.tsx`의 `Job` 타입 정의(파일 상단 `type Job = ...`)를 아래로 교체(없으면 추가):
```tsx
type Job = {
  state: 'idle' | 'running' | 'done' | 'failed';
  running: boolean;
  processed: number;
  target: number;
  added: number;
  skipped: number;
  failed: number[];
  log: string[];
  error: string | null;
};
```

- [ ] **Step 3: 영화 수량 상태 + 핸들러 교체**

`const [collectN, setCollectN] = useState(50);` 아래에 추가:
```tsx
  const [backfillN, setBackfillN] = useState(100);
```

`runBackfill` 핸들러(현재 `streamJob('/api/manager/movies/backfill', ...)`)를 교체:
```tsx
  const runBackfill = () => {
    if (backfill?.running) return;
    const n = Math.max(1, Math.min(backfillN, 2000));
    startAndPoll(`/api/manager/movies/backfill?limit=${n}`, 'movie', setBackfill, fetchStats);
  };
```

`runCollect` 핸들러(현재 `streamJob(...)`)를 교체:
```tsx
  const runCollect = () => {
    if (collect?.running) return;
    const n = Math.max(1, Math.min(collectN, remaining ?? collectN));
    startAndPoll(`/api/manager/subtitles/collect?limit=${n}`, 'subtitle', setCollect, () => {
      fetchStats();
      fetchRemaining();
    });
  };
```
(기존 runCollect 내부에서 호출하던 stats/remaining 갱신 로직을 onDone 콜백으로 옮김. 기존에 `fetchRemaining`/`fetchStats` 이름이 다르면 해당 함수명에 맞춤.)

- [ ] **Step 4: 영화 수량 입력 UI 추가**

영화 추가 버튼(현재 `{backfill?.running ? '추가 중…' : '새로운 영화 100개 추가'}`)을 수량 입력 + 버튼으로 교체:
```tsx
            <input
              type="number"
              min={1}
              max={2000}
              value={backfillN}
              onChange={(e) => setBackfillN(Number(e.target.value))}
              style={{ width: 100, marginRight: 8 }}
            />
            <button onClick={runBackfill} disabled={backfill?.running} style={actionBtn(!!backfill?.running)}>
              {backfill?.running ? '추가 중…' : `영화 ${backfillN}개 추가`}
            </button>
```

- [ ] **Step 5: JobBanner를 진행/로그/에러 패널로 교체**

`JobBanner` 컴포넌트를 교체:
```tsx
function JobBanner({ job, label, onClose }: { job: Job; label: string; onClose: () => void }) {
  const pct = job.target ? Math.round((job.processed / job.target) * 100) : 0;
  return (
    <div style={{ border: '1px solid #333', borderRadius: 8, padding: 12, margin: '8px 0', background: '#111' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{label} — {job.state}</strong>
        <button onClick={onClose} style={{ background: 'none', color: '#aaa', border: 'none', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ height: 6, background: '#333', borderRadius: 3, margin: '6px 0' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#4ade80', borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 12, color: '#aaa' }}>
        {job.processed}/{job.target} · 신규 {job.added} · 스킵 {job.skipped} · 실패 {job.failed.length}
      </div>
      {job.error && (
        <div style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>에러: {job.error}</div>
      )}
      {job.log?.length > 0 && (
        <pre style={{ maxHeight: 160, overflow: 'auto', background: '#000', color: '#ddd',
          fontSize: 11, padding: 8, marginTop: 6, borderRadius: 4 }}>
          {job.log.slice(-200).join('\n')}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 6: lint + 빌드 확인**

Run (4K_FE/): `npm run lint`
Expected: 에러 없음. (타입 불일치 시 Job 필드/핸들러명 정합 확인.)

- [ ] **Step 7: Commit**

```bash
git add 4K_FE/app/manager/page.tsx
git commit -m "feat(fe): 매니저 영화 수량 입력 + 폴링 진행/로그/에러 패널"
```

---

## 배포 후 수동 작업 (코드 외 — 사용자)

1. main 병합 + push → CI가 BE/FE 이미지 빌드, kustomize newTag bump → ArgoCD 동기화.
2. 신규 `subtitle-collect` CronJob 생성 확인: `kubectl get cronjob -n be`.
3. 매니저에서 영화/자막 수동 수집 → 진행바·로그·에러 표시 확인(타임아웃 없이 완주).
4. 다음 날 03:00/04:00(KST) 크론 자동 실행 로그 확인: `kubectl logs -n be job/<cronjob-pod>` 또는 ArgoCD.

---

## Self-Review 결과

**Spec coverage:** §2 결정(백그라운드+폴링/인메모리/헤드리스/공유로직) → Task 3·4·6·7; §4.1 크론 → Task 5; §4.2 자막 CLI → Task 2; §4.3 jobs.py → Task 3; §4.4 엔드포인트 → Task 4; §4.5 FE → Task 6·7; §6 에러처리(SubdlRateLimit→failed) → Task 3 `_run` except + Task 1 이벤트; §7 테스트 → 각 Task. 누락 없음.

**Placeholder scan:** 모든 코드/명령 구체화. FE는 테스트 러너 부재로 lint+수동 확인(의도적). page.tsx 일부는 기존 식별자명(`fetchStats`/`fetchRemaining`/`actionBtn`)에 맞추라는 단서 포함 — 실제 파일에서 정합.

**Type consistency:** 이벤트 필드(tmdb_id/result/error) Task 1에서 정의 → Task 2 run()·Task 3 `_log_line`에서 동일 사용. jobs.start/get/_run/_idle/_now/_REGISTRY/_TASKS 시그니처가 Task 3 정의와 Task 4 사용에서 일치. FE Job 타입 필드가 BE jobs 상태 스키마와 1:1.
```