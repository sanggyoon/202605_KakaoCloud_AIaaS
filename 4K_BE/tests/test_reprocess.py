import httpx

from fastapi.testclient import TestClient
from app import main


def _patch(monkeypatch, handler):
    orig = httpx.AsyncClient

    def factory(*a, **k):
        k.pop("timeout", None); k.pop("verify", None)
        return orig(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(main.httpx, "AsyncClient", factory)


def test_reprocess_resets_downstream(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    monkeypatch.setenv("SUBDL_API_KEY", "s")
    posted = []

    async def fake_one(client, tmdb_id):
        return {"state": "done", "message": "OK"}

    async def fake_reset(client, tmdb_id):
        posted.append(tmdb_id)

    monkeypatch.setattr(main.sc, "collect_one", fake_one)
    monkeypatch.setattr(main.sc, "reset_downstream", fake_reset)
    _patch(monkeypatch, lambda req: httpx.Response(200, json=[]))

    res = TestClient(main.app).post("/api/movies/100/reprocess")
    assert res.status_code == 200
    assert res.json()["subtitle"] == "done"
    assert posted == [100]


def test_active_model_includes_metrics(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")

    def handler(req):
        if "/rest/v1/model_versions" in str(req.url):
            return httpx.Response(200, json=[{"model_version": "roberta-va-v1",
                                              "metrics": {"spearman_movie_arousal": 0.75}}])
        return httpx.Response(404)

    _patch(monkeypatch, handler)
    res = TestClient(main.app).get("/api/active-model")
    assert res.json()["version"] == "roberta-va-v1"
    assert res.json()["metrics"]["spearman_movie_arousal"] == 0.75
