"""하이브리드 씬 분할: 무발화 gap(규칙) + 문맥 유사도(의미), 최소 씬 길이 게이트.

경계(gap 초과 OR 유사도 미달)는 **현재 씬이 최소 크기(min_ms·min_lines)에 도달했을 때만**
실제로 분할한다. → 씬 개수가 대략 (총 길이 / min_ms)로 안정화되어 과분할을 막는다.
"""
import os

import numpy as np


def config_from_env() -> tuple[int, float, int, int]:
    return (
        int(os.getenv("SCENE_GAP_MS", "3000")),
        float(os.getenv("SCENE_SIM_THRESHOLD", "0.5")),
        int(os.getenv("SCENE_MIN_LINES", "3")),
        int(os.getenv("SCENE_MIN_MS", "120000")),   # 최소 씬 길이(기본 2분)
    )


def split_method(gap_ms: int, sim_threshold: float, min_ms: int) -> str:
    return f"gap{gap_ms}+sbert-minilm-sim{sim_threshold}+min{min_ms}"


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def split_scenes(features: list[dict], embeddings: np.ndarray,
                 gap_ms: int, sim_threshold: float, min_lines: int, min_ms: int) -> list[list[int]]:
    """features와 embeddings(정렬됨)를 받아 cue 인덱스의 씬별 그룹 반환.

    경계 = (gap_before_ms > gap_ms) OR (현재 씬 centroid와의 cosine < sim_threshold).
    단, 현재 씬이 min_lines 줄 이상이고 min_ms 이상 길어졌을 때만 실제 분할.
    """
    n = len(features)
    if n == 0:
        return []
    scenes: list[list[int]] = []
    current = [0]
    centroid_sum = embeddings[0].astype(float).copy()
    for i in range(1, n):
        gap = features[i].get("gap_before_ms") or 0
        gap_boundary = gap > gap_ms
        centroid = centroid_sum / len(current)
        sem_boundary = _cosine(embeddings[i], centroid) < sim_threshold

        cur_dur = features[current[-1]]["end_ms"] - features[current[0]]["start_ms"]
        big_enough = len(current) >= min_lines and cur_dur >= min_ms

        if (gap_boundary or sem_boundary) and big_enough:
            scenes.append(current)
            current = [i]
            centroid_sum = embeddings[i].astype(float).copy()
        else:
            current.append(i)
            centroid_sum += embeddings[i]
    scenes.append(current)
    return scenes
