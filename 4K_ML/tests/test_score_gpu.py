from serving import score_scenes_gpu as g


def test_scene_score_rows_maps_axes_and_clamps():
    scenes = [{"scenes_id": 10}, {"scenes_id": 11}]
    preds = [{"arousal": 0.4, "valence": 1.2}, {"arousal": -0.1, "valence": 0.7}]
    rows = g.scene_score_rows(scenes, preds, "roberta-va-v1")
    assert rows == [
        {"scenes_id": 10, "score": 0.4, "model_version": "roberta-va-v1::arousal"},
        {"scenes_id": 10, "score": 1.0, "model_version": "roberta-va-v1::valence"},  # clamp 1.2→1.0
        {"scenes_id": 11, "score": 0.0, "model_version": "roberta-va-v1::arousal"},  # clamp -0.1→0.0
        {"scenes_id": 11, "score": 0.7, "model_version": "roberta-va-v1::valence"},
    ]


def test_run_flow_loads_active_model_and_upserts(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    calls = {"upsert": [], "states": []}

    monkeypatch.setattr(g.predict_core, "load_artifacts",
                        lambda model_dir, **kw: ("M", "S", "T", {"max_len": 8}))
    monkeypatch.setattr(g.predict_core, "score_instances",
                        lambda m, s, t, ml, inst: [{"arousal": 0.5, "valence": 0.5} for _ in inst])
    monkeypatch.setattr(g.db, "fetch_active_version", lambda c: "roberta-va-v1")
    monkeypatch.setattr(g.db, "ensure_model_versions", lambda c, mv: None)
    monkeypatch.setattr(g.db, "fetch_score_targets", lambda c: [1])
    monkeypatch.setattr(g.db, "fetch_movie_scenes_for_scoring",
                        lambda c, tid: [{"scenes_id": 10, "text": "a", "progress_ratio": 0.1,
                                         "start_ms": 0, "end_ms": 1, "dialogue_count": 1,
                                         "avg_gap_before_ms": 0.0}])
    monkeypatch.setattr(g.db, "upsert_scene_scores", lambda c, rows: calls["upsert"].extend(rows))
    monkeypatch.setattr(g.db, "set_score_state", lambda c, tid, st: calls["states"].append((tid, st)))

    class FakeClient:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(g.httpx, "Client", lambda *a, **k: FakeClient())

    g.run()
    assert {r["model_version"] for r in calls["upsert"]} == {
        "roberta-va-v1::arousal", "roberta-va-v1::valence"}
    assert calls["states"] == [(1, "done")]
