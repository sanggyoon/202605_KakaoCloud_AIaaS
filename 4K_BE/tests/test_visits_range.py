import httpx
from fastapi.testclient import TestClient
from app import main


def _patch(monkeypatch, handler):
    orig = httpx.AsyncClient

    def factory(*a, **k):
        k.pop("timeout", None); k.pop("verify", None)
        return orig(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(main.httpx, "AsyncClient", factory)


def test_visits_range_counts(monkeypatch):
    seen = {}

    def handler(req):
        if "/rest/v1/visits" in str(req.url):
            seen["url"] = str(req.url)
            return httpx.Response(206, json=[], headers={"Content-Range": "0-0/7"})
        return httpx.Response(404)

    _patch(monkeypatch, handler)
    res = TestClient(main.app).get("/api/visits/range?start=2026-06-01&end=2026-06-07")
    assert res.status_code == 200
    assert res.json()["count"] == 7
    assert "created_at.gte.2026-06-01" in seen["url"]
    assert "created_at.lt.2026-06-08" in seen["url"]  # end+1일


def test_visits_range_bad_date(monkeypatch):
    _patch(monkeypatch, lambda req: httpx.Response(200, json=[]))
    res = TestClient(main.app).get("/api/visits/range?start=2026-13-01&end=2026-06-07")
    assert res.status_code == 400
