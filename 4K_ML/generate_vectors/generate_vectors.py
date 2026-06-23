#!/usr/bin/env python3
"""G — vm5 roberta 씬 점수 → vm4 movie_vectors (arousal z-score / valence raw).

env: AI_DATABASE_URL, AI_DATABASE_KEY (vm5)  /  DATA_SUPABASE_URL, DATA_SUPABASE_KEY (vm4)
실행: python -m generate_vectors.generate_vectors
"""
import os

import httpx

from generate_vectors import db, transform

SMOOTHING = f"savgol_w{transform.SAVGOL_WINDOW}_p{transform.SAVGOL_POLY}"


def select_vector_targets(ar_series_keys, vectored: set) -> list:
    """활성 점수는 있는데 활성벡터가 없는 영화. (순수)"""
    return [t for t in ar_series_keys if t not in vectored]


def build_rows(ar_series: dict, va_series: dict, model_version: str) -> tuple[list, set]:
    """arousal 유효 영화만 적재. (rows, done_tmdb_ids) 반환. (순수)"""
    arousal_mv = f"{model_version}::arousal"
    valence_mv = f"{model_version}::valence"
    rows: list = []
    done: set = set()
    for tmdb_id, pts in ar_series.items():
        av = transform.process_axis(pts, "arousal")
        if av is None:
            continue  # arousal 평탄/씬부족 → 영화 스킵
        rows.append({
            "tmdb_id": tmdb_id, "vector": av, "vector_version": arousal_mv,
            "normalization": "zscore", "smoothing_method": SMOOTHING,
        })
        vpts = va_series.get(tmdb_id)
        if vpts:
            vv = transform.process_axis(vpts, "valence")
            if vv is not None:
                rows.append({
                    "tmdb_id": tmdb_id, "vector": vv, "vector_version": valence_mv,
                    "normalization": "raw", "smoothing_method": SMOOTHING,
                })
        done.add(tmdb_id)
    return rows, done


def run() -> None:
    if not os.getenv("AI_DATABASE_URL") or not os.getenv("AI_DATABASE_KEY"):
        raise SystemExit("AI_DATABASE_URL, AI_DATABASE_KEY 필요 (vm5).")
    if not os.getenv("DATA_SUPABASE_URL") or not os.getenv("DATA_SUPABASE_KEY"):
        raise SystemExit("DATA_SUPABASE_URL, DATA_SUPABASE_KEY 필요 (vm4).")

    with httpx.Client(timeout=60) as client:
        mv = db.fetch_active_version(client)
        arousal_mv = f"{mv}::arousal"
        print(f"=== 활성 모델: {mv} ===")

        scene_index = db.fetch_scene_index(client)
        ar_scores = db.fetch_axis_scores(client, arousal_mv)
        va_scores = db.fetch_axis_scores(client, f"{mv}::valence")
        ar_series = db.build_series(ar_scores, scene_index)
        va_series = db.build_series(va_scores, scene_index)

        vectored = db.fetch_vectored_tmdbs(client, arousal_mv)
        targets = set(select_vector_targets(ar_series.keys(), vectored))
        ar_t = {t: ar_series[t] for t in targets}
        va_t = {t: va_series[t] for t in targets if t in va_series}
        print(f"  점수 보유 {len(ar_series):,} / 기존 벡터 {len(vectored):,} / 신규 대상 {len(ar_t):,}")

        rows, done = build_rows(ar_t, va_t, mv)
        print(f"  벡터 행 {len(rows):,} / 신규 적재 {len(done):,}")
        db.upsert_vectors(client, rows)
        db.set_has_vector(client, list(done))
        db.set_vector_state(client, list(done))

        # has_vector 재동기화: 활성벡터 보유 = 기존 ∪ 신규
        db.reconcile_has_vector(client, vectored | done)
        print("✅ 완료")


if __name__ == "__main__":
    run()
