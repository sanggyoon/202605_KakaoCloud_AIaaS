import json

import httpx

from labeling import db


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _env(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")


def test_fetch_label_targets_filters(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        return httpx.Response(200, json=[
            {"tmdb_id": 1, "parse_state": "done", "label_state": "pending"},
            {"tmdb_id": 2, "parse_state": "done", "label_state": "done"},
            {"tmdb_id": 3, "parse_state": "pending", "label_state": "pending"},
        ])

    assert db.fetch_label_targets(_client(handler)) == [1]


def test_fetch_scenes_two_calls(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        if "subtitles" in req.url.path:
            return httpx.Response(200, json=[{"id": 55}])
        assert "subtitles_id=eq.55" in str(req.url)
        assert "order=scene_index" in str(req.url)
        return httpx.Response(200, json=[
            {"id": 100, "scene_index": 0, "text": "a"},
            {"id": 101, "scene_index": 1, "text": "b"},
        ])

    out = db.fetch_scenes(_client(handler), 7)
    assert out == [
        {"scenes_id": 100, "scene_index": 0, "text": "a"},
        {"scenes_id": 101, "scene_index": 1, "text": "b"},
    ]


def test_fetch_scenes_no_subtitle(monkeypatch):
    _env(monkeypatch)
    assert db.fetch_scenes(_client(lambda req: httpx.Response(200, json=[])), 9) == []


def test_ensure_model_versions_payload(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.ensure_model_versions(_client(handler))
    versions = {r["model_version"] for r in seen["body"]}
    assert versions == {db.AROUSAL_MV, db.VALENCE_MV}
    assert "on_conflict=model_version" in seen["url"]


def test_upsert_scene_scores_conflict(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        return httpx.Response(201, json=[])

    db.upsert_scene_scores(_client(handler), [
        {"scenes_id": 1, "score": 0.5, "model_version": db.AROUSAL_MV},
    ])
    assert "on_conflict=scenes_id" in seen["url"] and "model_version" in seen["url"]


def test_set_label_state_posts(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.set_label_state(_client(handler), 7, "done")
    assert seen["body"][0]["tmdb_id"] == 7
    assert seen["body"][0]["label_state"] == "done"
