from generate_vectors import db


def test_build_series_joins_score_scene_subtitle():
    scene_index = {
        10: (0.1, 100),   # scene_id → (progress, tmdb_id)
        11: (0.5, 100),
        12: (0.9, 100),
        20: (0.2, 200),
        30: (0.3, None),  # tmdb 없음 → 제외
        40: (None, 300),  # progress 없음 → 제외
    }
    scores = [
        {"scenes_id": 10, "score": 0.2},
        {"scenes_id": 11, "score": 0.8},
        {"scenes_id": 12, "score": 0.4},
        {"scenes_id": 20, "score": 0.5},
        {"scenes_id": 30, "score": 0.9},   # tmdb 없음
        {"scenes_id": 40, "score": 0.9},   # progress 없음
        {"scenes_id": 99, "score": 0.9},   # scene_index에 없음
    ]
    series = db.build_series(scores, scene_index)
    assert set(series.keys()) == {100, 200}
    assert sorted(series[100]) == [(0.1, 0.2), (0.5, 0.8), (0.9, 0.4)]
    assert series[200] == [(0.2, 0.5)]


def test_fetch_axis_scores_paginates(monkeypatch):
    calls = {"n": 0}

    class FakeResp:
        def __init__(self, data): self._d = data
        def raise_for_status(self): pass
        def json(self): return self._d

    class FakeClient:
        def get(self, url, params=None, headers=None, auth=None, timeout=None):
            # 1페이지 가득(1000) → 2페이지 1건 → 종료
            calls["n"] += 1
            if calls["n"] == 1:
                return FakeResp([{"scenes_id": i, "score": 0.5} for i in range(1000)])
            return FakeResp([{"scenes_id": 1000, "score": 0.5}])

    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    rows = db.fetch_axis_scores(FakeClient(), "roberta-va-v1::arousal")
    assert len(rows) == 1001
    assert calls["n"] == 2
