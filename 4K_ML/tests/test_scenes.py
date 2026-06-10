import numpy as np

from subtitle_parse.scenes import split_scenes, config_from_env

A = [1.0, 0.0]   # 유사 그룹
B = [0.0, 1.0]   # A와 cosine 0 (< 0.5 → 의미 경계 후보)


def _f(start, end, gap):
    return {"start_ms": start, "end_ms": end, "gap_before_ms": gap}


# 기본 파라미터(테스트용): gap 3000, sim 0.5, min_lines 1, min_ms 1000
def _split(feats, emb, gap_ms=3000, sim=0.5, min_lines=1, min_ms=1000):
    return split_scenes(feats, np.array(emb), gap_ms, sim, min_lines, min_ms)


def test_gap_boundary_gated_by_min_ms():
    # 큰 gap이지만 현재 씬이 min_ms 미만이면 분할 보류 → 충분히 길어진 뒤 분할
    feats = [_f(0, 500, None), _f(5000, 5500, 4500), _f(10000, 10500, 4500)]
    assert _split(feats, [A, A, A]) == [[0, 1], [2]]


def test_semantic_boundary_when_long_enough():
    # 작은 gap, 0/1/2 유사(씬 길어짐), 3은 의미 다름 → 분할
    feats = [_f(0, 500, None), _f(600, 1100, 100), _f(1200, 1700, 100), _f(1800, 2300, 100)]
    assert _split(feats, [A, A, A, B]) == [[0, 1, 2], [3]]


def test_semantic_ignored_when_scene_too_short():
    # 1이 의미 다르지만 현재 씬[0]이 min_ms 미만 → 경계 무시(병합)
    feats = [_f(0, 500, None), _f(600, 1100, 100)]
    assert _split(feats, [A, B]) == [[0, 1]]


def test_single_scene_when_similar_and_small_gaps():
    feats = [_f(0, 500, None), _f(600, 1100, 100), _f(1200, 1700, 100)]
    assert _split(feats, [A, A, A]) == [[0, 1, 2]]


def test_min_lines_also_gates():
    # min_ms는 충족하지만 min_lines=3 미달이면 분할 보류
    feats = [_f(0, 2000, None), _f(6000, 8000, 4000)]  # 현재 씬[0] dur 2000≥min_ms, 그러나 1줄<3
    assert _split(feats, [A, A], min_lines=3) == [[0, 1]]


def test_empty():
    assert split_scenes([], np.zeros((0, 2)), 3000, 0.5, 3, 120000) == []


def test_config_defaults(monkeypatch):
    for k in ("SCENE_GAP_MS", "SCENE_SIM_THRESHOLD", "SCENE_MIN_LINES", "SCENE_MIN_MS"):
        monkeypatch.delenv(k, raising=False)
    assert config_from_env() == (3000, 0.5, 3, 120000)
