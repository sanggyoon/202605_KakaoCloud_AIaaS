import httpx

from subtitle_parse import db


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _env(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")


def test_fetch_targets_filters(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        return httpx.Response(200, json=[
            {"tmdb_id": 1, "subtitle_state": "done", "parse_state": "pending"},
            {"tmdb_id": 2, "subtitle_state": "done", "parse_state": "done"},
            {"tmdb_id": 3, "subtitle_state": "pending", "parse_state": "pending"},
        ])

    assert db.fetch_targets(_client(handler)) == [1]


def test_upsert_scenes_returns_rows(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["prefer"] = req.headers.get("prefer", "")
        return httpx.Response(201, json=[{"id": 10, "scene_index": 0}])

    out = db.upsert_scenes(_client(handler), [{"subtitles_id": 1, "scene_index": 0}])
    assert out[0]["id"] == 10
    assert "on_conflict=subtitles_id" in seen["url"] and "scene_index" in seen["url"]
    assert "return=representation" in seen["prefer"]


def test_set_parse_state_posts(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        import json
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.set_parse_state(_client(handler), 7, "done")
    assert seen["body"][0]["tmdb_id"] == 7
    assert seen["body"][0]["parse_state"] == "done"
