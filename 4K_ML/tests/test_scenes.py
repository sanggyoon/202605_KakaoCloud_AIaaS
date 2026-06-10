import numpy as np

from subtitle_parse.scenes import split_scenes, config_from_env

A = [1.0, 0.0]   # 유사 그룹
B = [0.0, 1.0]   # A와 cosine 0 (< 0.5 → 의미 경계)


def _feat(gap):
    return {"gap_before_ms": gap}


def test_gap_boundary():
    feats = [_feat(None), _feat(10000), _feat(0)]   # 두번째에서 큰 gap
    emb = np.array([A, A, A])
    assert split_scenes(feats, emb, gap_ms=3000, sim_threshold=0.5, min_lines=1) == [[0], [1, 2]]


def test_semantic_boundary_when_min_lines_met():
    feats = [_feat(None), _feat(0), _feat(0), _feat(0)]
    emb = np.array([A, A, A, B])
    assert split_scenes(feats, emb, gap_ms=3000, sim_threshold=0.5, min_lines=3) == [[0, 1, 2], [3]]


def test_semantic_ignored_below_min_lines():
    feats = [_feat(None), _feat(0)]
    emb = np.array([A, B])
    assert split_scenes(feats, emb, gap_ms=3000, sim_threshold=0.5, min_lines=3) == [[0, 1]]


def test_single_scene_when_similar_and_small_gaps():
    feats = [_feat(None), _feat(0), _feat(0)]
    emb = np.array([A, A, A])
    assert split_scenes(feats, emb, gap_ms=3000, sim_threshold=0.5, min_lines=3) == [[0, 1, 2]]


def test_empty():
    assert split_scenes([], np.zeros((0, 2)), 3000, 0.5, 3) == []


def test_config_defaults(monkeypatch):
    for k in ("SCENE_GAP_MS", "SCENE_SIM_THRESHOLD", "SCENE_MIN_LINES"):
        monkeypatch.delenv(k, raising=False)
    assert config_from_env() == (3000, 0.5, 3)
