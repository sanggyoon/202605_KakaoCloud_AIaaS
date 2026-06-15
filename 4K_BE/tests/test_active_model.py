import httpx
from fastapi.testclient import TestClient
from app import main


def _patch(monkeypatch, handler):
    orig = httpx.AsyncClient

    def factory(*a, **k):
        k.pop("timeout", None); k.pop("verify", None)
        return orig(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(main.httpx, "AsyncClient", factory)


def test_active_model_returns_base_version(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")

    def handler(req):
        if "/rest/v1/model_versions" in str(req.url):
            return httpx.Response(200, json=[{"model_version": "roberta-va-v1"}])
        return httpx.Response(404)

    _patch(monkeypatch, handler)
    res = TestClient(main.app).get("/api/active-model")
    assert res.status_code == 200
    assert res.json()["version"] == "roberta-va-v1"


def test_active_model_fallback(monkeypatch):
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    monkeypatch.delenv("AI_DATABASE_KEY", raising=False)

    def handler(req):
        return httpx.Response(200, json=[])

    _patch(monkeypatch, handler)
    res = TestClient(main.app).get("/api/active-model")
    assert res.status_code == 200
    assert res.json()["version"] == "roberta-va-v1"  # 폴백
