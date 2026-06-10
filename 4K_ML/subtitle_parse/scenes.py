"""하이브리드 씬 분할: 무발화 gap(규칙) + 문맥 유사도(의미)."""
import os

import numpy as np


def config_from_env() -> tuple[int, float, int]:
    return (
        int(os.getenv("SCENE_GAP_MS", "3000")),
        float(os.getenv("SCENE_SIM_THRESHOLD", "0.5")),
        int(os.getenv("SCENE_MIN_LINES", "3")),
    )


def split_method(gap_ms: int, sim_threshold: float) -> str:
    return f"gap{gap_ms}+sbert-minilm-sim{sim_threshold}"


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def split_scenes(features: list[dict], embeddings: np.ndarray,
                 gap_ms: int, sim_threshold: float, min_lines: int) -> list[list[int]]:
    """features와 embeddings(정렬됨)를 받아 cue 인덱스의 씬별 그룹 반환."""
    n = len(features)
    if n == 0:
        return []
    scenes: list[list[int]] = []
    current = [0]
    centroid_sum = embeddings[0].astype(float).copy()
    for i in range(1, n):
        gap = features[i].get("gap_before_ms") or 0
        boundary = gap > gap_ms
        if not boundary:
            centroid = centroid_sum / len(current)
            if _cosine(embeddings[i], centroid) < sim_threshold and len(current) >= min_lines:
                boundary = True
        if boundary:
            scenes.append(current)
            current = [i]
            centroid_sum = embeddings[i].astype(float).copy()
        else:
            current.append(i)
            centroid_sum += embeddings[i]
    scenes.append(current)
    return scenes
