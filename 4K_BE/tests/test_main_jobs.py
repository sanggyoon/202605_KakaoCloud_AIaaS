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
