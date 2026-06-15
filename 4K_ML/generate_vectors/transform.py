"""순수 변환 — (progress, score) 시계열 → 200차원 벡터.

arousal: 고정 [0,1] 리샘플 + savgol + z-score (평탄이면 None).
valence: 고정 [0,1] 리샘플 + savgol + raw 유지.
"""
import numpy as np
from scipy.signal import savgol_filter

TARGET_POINTS = 200
SAVGOL_WINDOW = 11
SAVGOL_POLY = 2
MIN_SCENES = 5


def _resample_smooth(points: list[tuple[float, float]]) -> np.ndarray | None:
    if len(points) < MIN_SCENES:
        return None
    pts = sorted(points, key=lambda p: p[0])
    x = np.array([p[0] for p in pts], dtype=float)
    y = np.array([p[1] for p in pts], dtype=float)
    # 고정 [0,1] 그리드 — 진행도 %가 실제 영화 진행도. 범위 밖은 np.interp가 끝값으로 clamp.
    x_new = np.linspace(0.0, 1.0, TARGET_POINTS)
    y_res = np.interp(x_new, x, y)
    w = min(SAVGOL_WINDOW, len(y_res) - 1)
    if w % 2 == 0:
        w -= 1
    if w < SAVGOL_POLY + 1:
        return y_res
    return savgol_filter(y_res, window_length=w, polyorder=SAVGOL_POLY)


def process_axis(points: list[tuple[float, float]], axis: str) -> list[float] | None:
    """axis='arousal' → z-score(평탄 None) / axis='valence' → raw."""
    sm = _resample_smooth(points)
    if sm is None:
        return None
    if axis == "arousal":
        std = float(sm.std())
        if std < 1e-9:
            return None
        return ((sm - sm.mean()) / std).tolist()
    # valence raw — savgol 오버슈트로 [0,1] 밖으로 나갈 수 있어 색상용으로 clip
    return np.clip(sm, 0.0, 1.0).tolist()
