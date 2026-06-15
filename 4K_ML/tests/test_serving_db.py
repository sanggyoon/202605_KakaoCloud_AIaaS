import json

import httpx

from serving import db


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _env(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")


def test_fetch_score_targets(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        url = str(req.url)
        if "/rest/v1/model_versions" in url:
            return httpx.Response(200, json=[{"model_version": "roberta-va-v1"}])
        if "/rest/v1/processing_status" in url:
            return httpx.Response(200, json=[
                {"tmdb_id": 1, "parse_state": "done"},
                {"tmdb_id": 2, "parse_state": "done"},
                {"tmdb_id": 3, "parse_state": "pending"},
            ])
        if "/rest/v1/subtitles" in url:
            return httpx.Response(200, json=[
                {"id": 10, "tmdb_id": 1}, {"id": 20, "tmdb_id": 2}, {"id": 30, "tmdb_id": 3},
            ])
        if "/rest/v1/scenes" in url:
            return httpx.Response(200, json=[
                {"id": 100, "subtitles_id": 10}, {"id": 200, "subtitles_id": 20}, {"id": 300, "subtitles_id": 30},
            ])
        if "/rest/v1/scene_scores" in url:
            return httpx.Response(200, json=[{"scenes_id": 200}])  # 영화2만 점수 보유
        return httpx.Response(404)

    # 영화1: 파싱완료+점수없음→타깃, 영화2: 점수보유→제외, 영화3: 파싱미완→제외
    assert db.fetch_score_targets(_client(handler)) == [1]


def test_fetch_movie_scenes_for_scoring(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        u = str(req.url)
        if "/subtitles" in u:
            return httpx.Response(200, json=[{"id": 50}])
        if "/scenes" in u:
            return httpx.Response(200, json=[
                {"id": 100, "scene_index": 0, "text": "a b", "progress_ratio": 0.1,
                 "start_ms": 0, "end_ms": 2000, "dialogue_count": 2},
            ])
        if "/dialogues" in u:
            return httpx.Response(200, json=[
                {"scenes_id": 100, "gap_before_ms": 100},
                {"scenes_id": 100, "gap_before_ms": 300},
            ])
        return httpx.Response(404)

    out = db.fetch_movie_scenes_for_scoring(_client(handler), 7)
    assert len(out) == 1
    r = out[0]
    assert r["scenes_id"] == 100 and r["scene_index"] == 0
    assert r["text"] == "a b" and r["avg_gap_before_ms"] == 200.0
    assert "arousal" not in r  # 라벨 없음(추론 대상)


def test_ensure_model_versions(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.ensure_model_versions(_client(handler), "roberta-va-v1")
    vers = {r["model_version"] for r in seen["body"]}
    assert vers == {"roberta-va-v1::arousal", "roberta-va-v1::valence"}
    assert "on_conflict=model_version" in seen["url"]


def test_upsert_scene_scores_and_state(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen.setdefault("urls", []).append(str(req.url))
        if req.method == "POST" and "scene_scores" in str(req.url):
            seen["scores"] = json.loads(req.content)
        if req.method == "POST" and "processing_status" in str(req.url):
            seen["state"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.upsert_scene_scores(_client(handler), [{"scenes_id": 1, "score": 0.5,
                                               "model_version": "roberta-va-v1::arousal"}])
    db.set_score_state(_client(handler), 7, "done")
    assert any("on_conflict=scenes_id" in u for u in seen["urls"])
    assert seen["state"][0]["tmdb_id"] == 7 and seen["state"][0]["score_state"] == "done"
