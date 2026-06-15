#!/usr/bin/env python3
"""G — vm5 roberta 씬 점수 → vm4 movie_vectors (arousal z-score / valence raw).

env: AI_DATABASE_URL, AI_DATABASE_KEY (vm5)  /  DATA_SUPABASE_URL, DATA_SUPABASE_KEY (vm4)
실행: python -m generate_vectors.generate_vectors
"""
import os

import httpx

from generate_vectors import db, transform

MODEL_VERSION = "roberta-va-v1"
AROUSAL_MV = f"{MODEL_VERSION}::arousal"
VALENCE_MV = f"{MODEL_VERSION}::valence"
SMOOTHING = f"savgol_w{transform.SAVGOL_WINDOW}_p{transform.SAVGOL_POLY}"


def build_rows(ar_series: dict[int, list], va_series: dict[int, list]) -> tuple[list[dict], set]:
    """arousal 유효 영화만 적재. (rows, done_tmdb_ids) 반환. (순수)"""
    rows: list[dict] = []
    done: set = set()
    for tmdb_id, pts in ar_series.items():
        av = transform.process_axis(pts, "arousal")
        if av is None:
            continue  # arousal 평탄/씬부족 → 영화 스킵
        rows.append({
            "tmdb_id": tmdb_id, "vector": av, "vector_version": AROUSAL_MV,
            "normalization": "zscore", "smoothing_method": SMOOTHING,
        })
        vpts = va_series.get(tmdb_id)
        if vpts:
            vv = transform.process_axis(vpts, "valence")
            if vv is not None:
                rows.append({
                    "tmdb_id": tmdb_id, "vector": vv, "vector_version": VALENCE_MV,
                    "normalization": "raw", "smoothing_method": SMOOTHING,
                })
        done.add(tmdb_id)
    return rows, done


def run() -> None:
    if not os.getenv("AI_DATABASE_URL") or not os.getenv("AI_DATABASE_KEY"):
        raise SystemExit("AI_DATABASE_URL, AI_DATABASE_KEY 필요 (vm5).")
    if not os.getenv("DATA_SUPABASE_URL") or not os.getenv("DATA_SUPABASE_KEY"):
        raise SystemExit("DATA_SUPABASE_URL, DATA_SUPABASE_KEY 필요 (vm4).")

    with httpx.Client(timeout=60, verify=False) as client:
        print("=== vm5 읽기 ===")
        scene_index = db.fetch_scene_index(client)
        print(f"  scenes 인덱스: {len(scene_index):,}")
        ar_scores = db.fetch_axis_scores(client, AROUSAL_MV)
        va_scores = db.fetch_axis_scores(client, VALENCE_MV)
        print(f"  arousal 점수 {len(ar_scores):,} / valence 점수 {len(va_scores):,}")

        ar_series = db.build_series(ar_scores, scene_index)
        va_series = db.build_series(va_scores, scene_index)
        print(f"  영화(arousal): {len(ar_series):,}")

        print("=== 변환 ===")
        rows, done = build_rows(ar_series, va_series)
        print(f"  벡터 행 {len(rows):,} / 적재 영화 {len(done):,} (스킵 {len(ar_series) - len(done):,})")

        print("=== vm4 적재 ===")
        db.upsert_vectors(client, rows)
        db.set_has_vector(client, list(done))
        db.set_vector_state(client, list(done))
        print("✅ 완료")


if __name__ == "__main__":
    run()
