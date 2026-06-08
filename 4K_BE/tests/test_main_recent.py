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


def test_recent_returns_movies(monkeypatch):
    def handler(req: httpx.Request) -> httpx.Response:
        assert "/rest/v1/movies" in str(req.url)
        assert req.url.params["order"] == "created_at.desc"
        assert req.url.params["limit"] == "50"
        return httpx.Response(200, json=[{"tmdb_id": 1, "title": "A", "has_vector": False}])
    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    res = client.get("/api/movies/recent")
    assert res.status_code == 200
    assert res.json()["movies"][0]["tmdb_id"] == 1


def test_recent_clamps_limit(monkeypatch):
    captured = {}
    def handler(req: httpx.Request) -> httpx.Response:
        captured["limit"] = req.url.params["limit"]
        return httpx.Response(200, json=[])
    _patch_client(monkeypatch, handler)
    client = TestClient(main.app)
    client.get("/api/movies/recent?limit=9999")
    assert captured["limit"] == "200"
