import httpx
from fastapi.testclient import TestClient
from app import main


def _patch(monkeypatch, handler):
    orig = httpx.AsyncClient

    def factory(*a, **k):
        k.pop("timeout", None); k.pop("verify", None)
        return orig(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(main.httpx, "AsyncClient", factory)


def test_delete_cleans_vector_and_resets_processing(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    hits = {"movies_del": 0, "vectors_del": 0, "proc_post": []}

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if req.method == "DELETE" and "/rest/v1/movies" in url:
            hits["movies_del"] += 1
            return httpx.Response(204)
        if req.method == "DELETE" and "/rest/v1/movie_vectors" in url:
            hits["vectors_del"] += 1
            return httpx.Response(204)
        if req.method == "POST" and "/rest/v1/processing_status" in url:
            hits["proc_post"].append(req.content.decode())
            return httpx.Response(201, json=[])
        return httpx.Response(404)

    _patch(monkeypatch, handler)
    res = TestClient(main.app).delete("/api/movies/100")
    assert res.status_code == 200 and res.json()["ok"] is True
    assert hits["movies_del"] == 1
    assert hits["vectors_del"] == 1
    assert any("parse_state" in p and "pending" in p for p in hits["proc_post"])
