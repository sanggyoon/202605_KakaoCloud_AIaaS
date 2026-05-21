#!/usr/bin/env python3
"""
training.scene_scores → 시계열 처리 → service.movie_vectors 생성

[사전 조건]
  1. vm4 Supabase Studio SQL Editor에서 unique constraint 추가:
       ALTER TABLE movie_vectors
       ADD CONSTRAINT movie_vectors_movies_id_version_key
       UNIQUE (movies_id, vector_version);
  2. 4K_ML/.env에 EXT_SUPABASE_URL, EXT_SUPABASE_KEY 추가

[사용법]
  pip install httpx python-dotenv numpy scipy
  python 4K_ML/generate_vectors.py
"""
import os
from collections import defaultdict

import httpx
import numpy as np
from dotenv import load_dotenv
from scipy.signal import savgol_filter

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ── 설정 ─────────────────────────────────────────────────────────────
EXT_URL         = os.getenv("EXT_SUPABASE_URL", "")       # 외부 SaaS URL
EXT_KEY         = os.getenv("EXT_SUPABASE_KEY", "")       # 외부 SaaS service_role key

DATA_URL        = os.getenv("DATA_SUPABASE_URL", "")      # vm4 URL
DATA_KEY        = os.getenv("DATA_SUPABASE_KEY", "")      # vm4 service_role key
DATA_BASIC_USER = os.getenv("DATA_BASIC_USER", "")        # nginx Basic Auth
DATA_BASIC_PASS = os.getenv("DATA_BASIC_PASS", "")

MODEL_VERSION   = "rule-v1"
TARGET_POINTS   = 200          # 리샘플링 포인트 수
SAVGOL_WINDOW   = 11           # Savitzky-Golay 윈도우 (홀수)
SAVGOL_POLY     = 2            # Savitzky-Golay 차수
MIN_SCENES      = 5            # 씬 수 최솟값 (미만이면 스킵)
PAGE_SIZE       = 1000         # Supabase REST API 페이지 크기
BATCH_SIZE      = 50           # upsert 배치 크기
# ─────────────────────────────────────────────────────────────────────


# ── HTTP 헬퍼 ─────────────────────────────────────────────────────────

def ext_fetch(table: str, params: dict = {}) -> list[dict]:
    """외부 Supabase SaaS — training 스키마 페이지네이션 fetch."""
    headers = {
        "apikey": EXT_KEY,
        "Authorization": f"Bearer {EXT_KEY}",
        "Accept-Profile": "training",
    }
    result = []
    offset = 0
    while True:
        r = httpx.get(
            f"{EXT_URL}/rest/v1/{table}",
            params={**params, "limit": PAGE_SIZE, "offset": offset},
            headers=headers,
            timeout=60,
        )
        r.raise_for_status()
        batch = r.json()
        result.extend(batch)
        print(f"  {table}: {len(result):,}행 수집 중...", end="\r")
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    print()
    return result


def vm4_fetch(table: str, params: dict = {}) -> list[dict]:
    """vm4 Supabase — public 스키마 페이지네이션 fetch."""
    headers = {"apikey": DATA_KEY}
    result = []
    offset = 0
    while True:
        r = httpx.get(
            f"{DATA_URL}/rest/v1/{table}",
            params={**params, "limit": PAGE_SIZE, "offset": offset},
            headers=headers,
            auth=(DATA_BASIC_USER, DATA_BASIC_PASS) if DATA_BASIC_USER else None,
            timeout=30,
            verify=False,
        )
        r.raise_for_status()
        batch = r.json()
        result.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return result


def vm4_upsert(table: str, rows: list[dict], on_conflict: str) -> None:
    """vm4 Supabase — 배치 upsert."""
    headers = {
        "apikey": DATA_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    total = len(rows)
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        r = httpx.post(
            f"{DATA_URL}/rest/v1/{table}",
            params={"on_conflict": on_conflict},
            json=batch,
            headers=headers,
            auth=(DATA_BASIC_USER, DATA_BASIC_PASS) if DATA_BASIC_USER else None,
            timeout=60,
            verify=False,
        )
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"upsert 실패 {r.status_code}: {r.text[:300]}")
        print(f"  upsert {min(i + BATCH_SIZE, total)}/{total}행 완료")


# ── 시계열 처리 ───────────────────────────────────────────────────────

def process(points: list[tuple[float, float]]) -> np.ndarray | None:
    """(progress_ratio, score) 리스트 → 200차원 정규화 벡터.

    씬 수 < MIN_SCENES 이거나 분산이 0이면 None 반환.
    """
    if len(points) < MIN_SCENES:
        return None

    points.sort(key=lambda p: p[0])
    x = np.array([p[0] for p in points], dtype=float)
    y = np.array([p[1] for p in points], dtype=float)

    # 1) 200포인트 선형 리샘플링
    x_new = np.linspace(x.min(), x.max(), TARGET_POINTS)
    y_res = np.interp(x_new, x, y)

    # 2) Savitzky-Golay 스무딩 (window는 홀수 & < 데이터 길이)
    w = min(SAVGOL_WINDOW, len(y_res) - 1)
    if w % 2 == 0:
        w -= 1
    y_smooth = savgol_filter(y_res, window_length=w, polyorder=SAVGOL_POLY)

    # 3) z-score 정규화 (mean=0, std=1)
    std = y_smooth.std()
    if std < 1e-9:
        return None  # 평탄한 시계열 스킵
    return (y_smooth - y_smooth.mean()) / std


# ── 메인 ─────────────────────────────────────────────────────────────

def main() -> None:
    if not EXT_URL or not EXT_KEY:
        raise SystemExit("EXT_SUPABASE_URL, EXT_SUPABASE_KEY 환경변수가 필요합니다.")
    if not DATA_URL or not DATA_KEY:
        raise SystemExit("DATA_SUPABASE_URL, DATA_SUPABASE_KEY 환경변수가 필요합니다.")

    # ── 1. 외부 SaaS 데이터 수집 ─────────────────────────────
    print("=== 1. 외부 Supabase 데이터 수집 ===")

    scores = ext_fetch(
        "scene_scores",
        {"select": "scenes_id,score", "model_version": f"eq.{MODEL_VERSION}"},
    )
    print(f"  → scene_scores: {len(scores):,}개")

    scenes = ext_fetch("scenes", {"select": "id,subtitles_id,progress_ratio"})
    print(f"  → scenes: {len(scenes):,}개")

    subtitles = ext_fetch("subtitles", {"select": "id,tmdb_id"})
    print(f"  → subtitles: {len(subtitles):,}개")

    # ── 2. Python 조인: scene_scores → scenes → subtitles ────
    print("\n=== 2. 데이터 조인 ===")

    sub_map   = {row["id"]: row["tmdb_id"] for row in subtitles}
    scene_map = {
        row["id"]: (row["progress_ratio"], sub_map.get(row["subtitles_id"]))
        for row in scenes
    }

    movie_points: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for row in scores:
        info = scene_map.get(row["scenes_id"])
        if info is None:
            continue
        progress_ratio, tmdb_id = info
        if tmdb_id is None or progress_ratio is None:
            continue
        movie_points[tmdb_id].append((progress_ratio, row["score"]))

    print(f"  → 조인 완료: {len(movie_points)}개 영화")

    # ── 3. vm4 movies 조회 (tmdb_id → id 매핑) ───────────────
    print("\n=== 3. vm4 movies 조회 ===")

    movies_rows = vm4_fetch("movies", {"select": "id,tmdb_id"})
    tmdb_to_id  = {row["tmdb_id"]: row["id"] for row in movies_rows}
    print(f"  → vm4 movies: {len(tmdb_to_id)}개")

    overlap = len(set(movie_points.keys()) & set(tmdb_to_id.keys()))
    print(f"  → 양쪽 겹침 (처리 대상): {overlap}개")

    # ── 4. 시계열 처리 ───────────────────────────────────────
    print("\n=== 4. 시계열 처리 ===")

    vectors = []
    skipped = 0

    for tmdb_id, points in movie_points.items():
        movie_id = tmdb_to_id.get(tmdb_id)
        if not movie_id:
            continue

        vec = process(points)
        if vec is None:
            skipped += 1
            continue

        vectors.append({
            "movies_id":        movie_id,
            "vector":           vec.tolist(),
            "vector_version":   MODEL_VERSION,
            "normalization":    "zscore",
            "smoothing_method": f"savgol_w{SAVGOL_WINDOW}_p{SAVGOL_POLY}",
        })

    print(f"  → 처리 완료: {len(vectors)}개")
    print(f"  → 스킵: {skipped}개 (씬 부족 또는 평탄 시계열)")

    # ── 5. vm4 movie_vectors upsert ─────────────────────────
    print(f"\n=== 5. vm4 movie_vectors upsert ({len(vectors)}개) ===")

    vm4_upsert("movie_vectors", vectors, on_conflict="movies_id,vector_version")

    print("\n✅ 완료")


if __name__ == "__main__":
    main()
