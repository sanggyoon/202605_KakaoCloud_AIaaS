from generate_vectors.generate_vectors import build_rows


def test_build_rows_arousal_required_valence_optional():
    # 정점 시계열(유효) + 평탄 valence
    peak = [(0.0, 0.0), (0.25, 0.0), (0.5, 1.0), (0.75, 0.0), (1.0, 0.0)]
    flat = [(i / 4, 0.5) for i in range(5)]
    ar = {100: peak, 200: peak, 300: [(0.0, 0.5)] * 5}  # 300은 arousal 평탄→스킵
    va = {100: peak, 200: flat, 300: peak}
    rows, done = build_rows(ar, va, "roberta-va-v1")

    versions = {(r["tmdb_id"], r["vector_version"]) for r in rows}
    # 100: arousal+valence 둘 다
    assert (100, "roberta-va-v1::arousal") in versions
    assert (100, "roberta-va-v1::valence") in versions
    # 200: arousal + valence(평탄이어도 raw 저장)
    assert (200, "roberta-va-v1::arousal") in versions
    assert (200, "roberta-va-v1::valence") in versions
    # 300: arousal 평탄 → 어떤 행도 없음
    assert all(r["tmdb_id"] != 300 for r in rows)
    assert done == {100, 200}

    # 메타 필드 확인
    a = next(r for r in rows if r["tmdb_id"] == 100 and r["vector_version"].endswith("arousal"))
    assert a["normalization"] == "zscore" and len(a["vector"]) == 200
    v = next(r for r in rows if r["tmdb_id"] == 100 and r["vector_version"].endswith("valence"))
    assert v["normalization"] == "raw" and len(v["vector"]) == 200
