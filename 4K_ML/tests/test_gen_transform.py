import numpy as np
from generate_vectors.transform import process_axis


def _peak_points():
    # 5점, 중앙(0.5)에 정점
    return [(0.0, 0.0), (0.25, 0.0), (0.5, 1.0), (0.75, 0.0), (1.0, 0.0)]


def test_arousal_zscore_centered_unit_variance():
    v = process_axis(_peak_points(), "arousal")
    assert v is not None
    arr = np.array(v)
    assert len(arr) == 200
    assert abs(arr.mean()) < 1e-6          # 평균 0
    assert abs(arr.std() - 1.0) < 1e-6     # 표준편차 1
    assert 90 <= int(arr.argmax()) <= 110  # 정점이 중앙 근처


def test_valence_raw_keeps_scale():
    v = process_axis(_peak_points(), "valence")
    assert v is not None
    arr = np.array(v)
    assert len(arr) == 200
    assert arr.min() >= -1e-9 and arr.max() <= 1.0 + 1e-9  # 0~1 유지
    assert arr.max() > 0.3                                 # 정점 살아있음
    assert arr.mean() > 1e-3                               # z-score 아님(양의 평균)


def test_flat_arousal_none_valence_raw():
    flat = [(i / 4, 0.5) for i in range(5)]
    assert process_axis(flat, "arousal") is None           # 평탄 → 스킵
    vv = process_axis(flat, "valence")
    assert vv is not None and len(vv) == 200
    assert all(abs(x - 0.5) < 1e-6 for x in vv)            # 0.5 그대로


def test_too_few_scenes_none():
    pts = [(0.0, 0.1), (0.3, 0.2), (0.6, 0.3), (1.0, 0.4)]  # 4점 < MIN_SCENES
    assert process_axis(pts, "arousal") is None
    assert process_axis(pts, "valence") is None
