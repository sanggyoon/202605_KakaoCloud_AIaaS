from train.evaluate import mae, pearson, movie_spearman


def test_mae():
    assert mae([0.0, 1.0], [0.5, 0.5]) == 0.5


def test_pearson_perfect():
    assert pearson([1.0, 2.0, 3.0], [2.0, 4.0, 6.0]) > 0.999


def test_pearson_constant_returns_zero():
    assert pearson([1.0, 1.0, 1.0], [1.0, 2.0, 3.0]) == 0.0


def test_movie_spearman_averages_per_movie():
    # movie 1: 완벽 단조 → rho 1.0 ; movie 2: 단일 씬 → 제외
    pred = [0.1, 0.2, 0.3, 0.9]
    true = [0.0, 0.5, 0.7, 0.4]
    movies = [1, 1, 1, 2]
    assert abs(movie_spearman(pred, true, movies) - 1.0) < 1e-9
