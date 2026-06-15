from generate_vectors.generate_vectors import select_vector_targets


def test_only_unvectored_movies():
    ar_series_keys = {100, 200, 300}
    vectored = {200}                      # 200은 이미 활성벡터 있음
    assert sorted(select_vector_targets(ar_series_keys, vectored)) == [100, 300]


def test_all_vectored_returns_empty():
    assert select_vector_targets({1, 2}, {1, 2}) == []
