import json

import httpx

from train import db


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _env(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")


def test_fetch_labeled_movies(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        return httpx.Response(200, json=[
            {"tmdb_id": 1, "label_state": "done"},
            {"tmdb_id": 2, "label_state": "pending"},
            {"tmdb_id": 3, "label_state": "done"},
        ])

    assert db.fetch_labeled_movies(_client(handler)) == [1, 3]


def test_fetch_movie_scenes_assembles(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        u = str(req.url)
        if "/subtitles" in u:
            return httpx.Response(200, json=[{"id": 50}])
        if "/scenes" in u:
            return httpx.Response(200, json=[
                {"id": 100, "scene_index": 0, "text": "a b", "progress_ratio": 0.1,
                 "start_ms": 0, "end_ms": 2000, "dialogue_count": 2},
                {"id": 101, "scene_index": 1, "text": "c", "progress_ratio": 0.9,
                 "start_ms": 3000, "end_ms": 4000, "dialogue_count": 1},
            ])
        if "/dialogues" in u:
            return httpx.Response(200, json=[
                {"scenes_id": 100, "gap_before_ms": 100},
                {"scenes_id": 100, "gap_before_ms": 300},
                {"scenes_id": 101, "gap_before_ms": None},
            ])
        if "/scene_scores" in u:
            return httpx.Response(200, json=[
                {"scenes_id": 100, "score": 0.8, "model_version": db.LABEL_AROUSAL},
                {"scenes_id": 100, "score": 0.2, "model_version": db.LABEL_VALENCE},
                {"scenes_id": 101, "score": 0.5, "model_version": db.LABEL_AROUSAL},
                # 101 valence 없음 → 제외 대상
            ])
        return httpx.Response(404)

    recs = db.fetch_movie_scenes(_client(handler), 7)
    # scene 100만 두 축 모두 있음
    assert len(recs) == 1
    r = recs[0]
    assert r["movie_id"] == 7 and r["scenes_id"] == 100
    assert r["arousal"] == 0.8 and r["valence"] == 0.2
    assert r["avg_gap_before_ms"] == 200.0  # (100+300)/2


def test_upsert_model_version_payload(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.upsert_model_version(_client(handler), "roberta-va-v1", "roberta-regressor",
                            {"mae_arousal": 0.1})
    assert "on_conflict=model_version" in seen["url"]
    assert seen["body"][0]["model_version"] == "roberta-va-v1"
    assert seen["body"][0]["metrics"] == {"mae_arousal": 0.1}
