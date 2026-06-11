import numpy as np

from train.features import compute_features, Scaler, FEATURE_ORDER


def test_feature_order():
    assert FEATURE_ORDER == ["progress_ratio", "scene_duration_s",
                             "dialogue_count", "words_per_sec", "avg_gap_before_ms"]


def test_compute_features_values():
    scene = {"progress_ratio": 0.5, "start_ms": 1000, "end_ms": 3000,
             "dialogue_count": 4, "text": "a b c d e f", "avg_gap_before_ms": 200.0}
    f = compute_features(scene)
    # duration = 2s, words = 6 → words_per_sec = 3.0
    assert f == [0.5, 2.0, 4.0, 3.0, 200.0]


def test_compute_features_zero_duration_guard():
    scene = {"progress_ratio": 0.0, "start_ms": 5000, "end_ms": 5000,
             "dialogue_count": 1, "text": "x", "avg_gap_before_ms": 0.0}
    f = compute_features(scene)
    assert f[1] == 1.0 and f[3] == 1.0  # duration floored at 1s, words_per_sec=1/1


def test_scaler_fit_transform_and_roundtrip(tmp_path):
    X = [[0.0, 2.0, 4.0, 3.0, 200.0], [1.0, 4.0, 8.0, 6.0, 0.0]]
    sc = Scaler().fit(X)
    Z = sc.transform(X)
    assert np.allclose(Z.mean(axis=0), 0.0, atol=1e-9)
    p = tmp_path / "scaler.json"
    sc.save(p)
    sc2 = Scaler.load(p)
    assert np.allclose(sc2.transform(X), Z)


def test_scaler_zero_std_no_nan():
    X = [[1.0], [1.0], [1.0]]  # std 0 → 1로 대체, nan 없음
    sc = Scaler().fit(X)
    assert not np.isnan(sc.transform(X)).any()
