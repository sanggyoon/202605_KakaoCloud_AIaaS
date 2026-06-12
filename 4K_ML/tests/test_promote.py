from serving.promote import decide


def test_promote_when_better_or_equal():
    cur = {"spearman_movie_arousal": 0.75, "mae_arousal": 0.088}
    cand = {"spearman_movie_arousal": 0.78, "mae_arousal": 0.085}
    ok, _ = decide(cur, cand)
    assert ok is True


def test_hold_when_spearman_worse():
    cur = {"spearman_movie_arousal": 0.75, "mae_arousal": 0.088}
    cand = {"spearman_movie_arousal": 0.70, "mae_arousal": 0.085}
    ok, _ = decide(cur, cand)
    assert ok is False


def test_hold_when_mae_worse_beyond_tol():
    cur = {"spearman_movie_arousal": 0.75, "mae_arousal": 0.088}
    cand = {"spearman_movie_arousal": 0.76, "mae_arousal": 0.120}  # +0.032 > tol 0.02
    ok, _ = decide(cur, cand)
    assert ok is False


def test_hold_on_missing_metrics():
    ok, _ = decide({"spearman_movie_arousal": None, "mae_arousal": None},
                   {"spearman_movie_arousal": 0.8, "mae_arousal": 0.08})
    assert ok is False
