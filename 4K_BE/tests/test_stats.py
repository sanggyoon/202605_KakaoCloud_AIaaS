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
