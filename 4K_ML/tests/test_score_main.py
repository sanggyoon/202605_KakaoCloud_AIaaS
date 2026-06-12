from serving import score_scenes as sc


def test_run_scores_and_states(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("KSERVE_PREDICT_URL", "http://kserve/predict")

    monkeypatch.setattr(sc.db, "fetch_score_targets", lambda c: [7, 8])
    scenes_by = {
        7: [{"scenes_id": 100, "scene_index": 0, "text": "a", "progress_ratio": 0.1,
             "start_ms": 0, "end_ms": 1000, "dialogue_count": 1, "avg_gap_before_ms": 0.0}],
        8: [],
    }
    monkeypatch.setattr(sc.db, "fetch_movie_scenes_for_scoring", lambda c, t: scenes_by[t])

    captured = {"scores": [], "states": [], "ensured": []}
    monkeypatch.setattr(sc.db, "ensure_model_versions",
                        lambda c, mv: captured["ensured"].append(mv))
    monkeypatch.setattr(sc.db, "upsert_scene_scores",
                        lambda c, rows: captured["scores"].extend(rows))
    monkeypatch.setattr(sc.db, "set_score_state",
                        lambda c, t, s, e=None: captured["states"].append((t, s)))

    def fake_predict(url, instances):
        return {"predictions": [{"arousal": 0.8, "valence": 0.2} for _ in instances],
                "model_version": "roberta-va-v1"}

    monkeypatch.setattr(sc, "call_predictor", fake_predict)

    sc.run()

    assert captured["scores"] == [
        {"scenes_id": 100, "score": 0.8, "model_version": "roberta-va-v1::arousal"},
        {"scenes_id": 100, "score": 0.2, "model_version": "roberta-va-v1::valence"},
    ]
    assert (7, "done") in captured["states"]
    assert "roberta-va-v1" in captured["ensured"]


def test_run_flags_failed(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("KSERVE_PREDICT_URL", "http://kserve/predict")
    monkeypatch.setattr(sc.db, "fetch_score_targets", lambda c: [7])
    monkeypatch.setattr(sc.db, "fetch_movie_scenes_for_scoring", lambda c, t:
                        [{"scenes_id": 100, "scene_index": 0, "text": "a", "progress_ratio": 0.1,
                          "start_ms": 0, "end_ms": 1000, "dialogue_count": 1, "avg_gap_before_ms": 0.0}])
    monkeypatch.setattr(sc.db, "ensure_model_versions", lambda c, mv: None)
    monkeypatch.setattr(sc.db, "upsert_scene_scores", lambda c, rows: None)
    states = []
    monkeypatch.setattr(sc.db, "set_score_state", lambda c, t, s, e=None: states.append((t, s)))

    def boom(url, instances):
        raise RuntimeError("predict 500")

    monkeypatch.setattr(sc, "call_predictor", boom)
    sc.run()
    assert states == [(7, "failed")]
