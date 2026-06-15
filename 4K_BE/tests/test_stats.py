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


def test_stats_returns_counts(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/rest/v1/processing_status" in url:
            return httpx.Response(200, json=[
                {"subtitle_state": "done", "parse_state": "done", "label_state": "done", "score_state": "done", "vector_state": "done"},
                {"subtitle_state": "done", "parse_state": "done", "label_state": "done", "score_state": "done", "vector_state": "pending"},
                {"subtitle_state": "skipped", "parse_state": None, "label_state": None, "score_state": None, "vector_state": None},
            ])
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
    p = data["processing"]
    assert p["subtitle_state"]["done"] == 2
    assert p["subtitle_state"]["skipped"] == 1
    assert p["vector_state"]["done"] == 1
    assert p["vector_state"]["pending"] == 2  # 1 pending + 1 null→pending


def test_stats_handles_missing_ai_env(monkeypatch):
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    monkeypatch.delenv("AI_DATABASE_KEY", raising=False)

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])  # visits만; AI env 없으면 processing은 {}

    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    res = client.get("/api/stats")
    assert res.status_code == 200
    assert res.json()["processing"] == {}
