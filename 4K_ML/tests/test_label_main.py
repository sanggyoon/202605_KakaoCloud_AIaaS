from labeling import label_scenes as main
from labeling import db


def test_clamp():
    assert main._clamp(1.5) == 1.0
    assert main._clamp(-0.2) == 0.0
    assert main._clamp(0.3) == 0.3


def test_parse_to_rows_makes_two_rows_per_scene():
    parsed = {"scenes": [
        {"scene_index": 0, "arousal": 0.9, "valence": 0.1},
        {"scene_index": 1, "arousal": 1.2, "valence": 0.5},  # arousal clamp
        {"scene_index": 9, "arousal": 0.5, "valence": 0.5},  # 매핑 없음 → 스킵
    ]}
    index_to_sid = {0: 100, 1: 101}
    rows = main.parse_to_rows(parsed, index_to_sid)
    assert rows == [
        {"scenes_id": 100, "score": 0.9, "model_version": db.AROUSAL_MV},
        {"scenes_id": 100, "score": 0.1, "model_version": db.VALENCE_MV},
        {"scenes_id": 101, "score": 1.0, "model_version": db.AROUSAL_MV},
        {"scenes_id": 101, "score": 0.5, "model_version": db.VALENCE_MV},
    ]


def test_run_writes_scores_and_states(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(main, "Anthropic", lambda: object())

    monkeypatch.setattr(main.db, "ensure_model_versions", lambda c: None)
    monkeypatch.setattr(main.db, "fetch_label_targets", lambda c: [7, 8])
    scenes_by = {
        7: [{"scenes_id": 100, "scene_index": 0, "text": "a"}],
        8: [],  # 씬 없음 → 배치 제외
    }
    monkeypatch.setattr(main.db, "fetch_scenes", lambda c, t: scenes_by[t])

    captured = {"scores": [], "states": []}
    monkeypatch.setattr(main.db, "upsert_scene_scores",
                        lambda c, rows: captured["scores"].extend(rows))
    monkeypatch.setattr(main.db, "set_label_state",
                        lambda c, t, s, e=None: captured["states"].append((t, s)))

    monkeypatch.setattr(main.batch, "build_requests", lambda movies: movies)
    monkeypatch.setattr(main.batch, "submit", lambda ac, reqs: "batch_x")
    monkeypatch.setattr(main.batch, "poll", lambda ac, bid: None)
    monkeypatch.setattr(main.batch, "collect", lambda ac, bid: iter([
        (7, {"scenes": [{"scene_index": 0, "arousal": 0.8, "valence": 0.2}]}, None),
    ]))

    main.run()

    assert captured["scores"] == [
        {"scenes_id": 100, "score": 0.8, "model_version": db.AROUSAL_MV},
        {"scenes_id": 100, "score": 0.2, "model_version": db.VALENCE_MV},
    ]
    assert (7, "done") in captured["states"]


def test_run_flags_failed(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setattr(main, "Anthropic", lambda: object())
    monkeypatch.setattr(main.db, "ensure_model_versions", lambda c: None)
    monkeypatch.setattr(main.db, "fetch_label_targets", lambda c: [7])
    monkeypatch.setattr(main.db, "fetch_scenes", lambda c, t:
                        [{"scenes_id": 100, "scene_index": 0, "text": "a"}])
    states = []
    monkeypatch.setattr(main.db, "set_label_state", lambda c, t, s, e=None: states.append((t, s)))
    monkeypatch.setattr(main.db, "upsert_scene_scores", lambda c, rows: None)
    monkeypatch.setattr(main.batch, "build_requests", lambda movies: movies)
    monkeypatch.setattr(main.batch, "submit", lambda ac, reqs: "b")
    monkeypatch.setattr(main.batch, "poll", lambda ac, bid: None)
    monkeypatch.setattr(main.batch, "collect", lambda ac, bid: iter([(7, None, "batch result errored")]))

    main.run()
    assert states == [(7, "failed")]
