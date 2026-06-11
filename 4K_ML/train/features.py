"""씬 숫자 피처(5개) + z-score 스케일러 (순수/직렬화 가능)."""
import json

import numpy as np

FEATURE_ORDER = ["progress_ratio", "scene_duration_s", "dialogue_count",
                 "words_per_sec", "avg_gap_before_ms"]


def compute_features(scene: dict) -> list[float]:
    """scene raw dict → FEATURE_ORDER 순서의 5-벡터."""
    dur_s = max((scene["end_ms"] - scene["start_ms"]) / 1000.0, 1.0)
    words = len((scene.get("text") or "").split())
    return [
        float(scene.get("progress_ratio") or 0.0),
        dur_s,
        float(scene.get("dialogue_count") or 0),
        words / dur_s,
        float(scene.get("avg_gap_before_ms") or 0.0),
    ]


class Scaler:
    """z-score 표준화. fit으로 mean/std 학습, transform 적용, json 직렬화."""

    def __init__(self, mean=None, std=None):
        self.mean = mean
        self.std = std

    def fit(self, X) -> "Scaler":
        arr = np.asarray(X, dtype=float)
        self.mean = arr.mean(axis=0)
        self.std = arr.std(axis=0)
        self.std = np.where(self.std == 0, 1.0, self.std)
        return self

    def transform(self, X) -> np.ndarray:
        arr = np.asarray(X, dtype=float)
        return (arr - self.mean) / self.std

    def to_dict(self) -> dict:
        return {"mean": [float(x) for x in self.mean],
                "std": [float(x) for x in self.std],
                "features": FEATURE_ORDER}

    @classmethod
    def from_dict(cls, d: dict) -> "Scaler":
        return cls(np.asarray(d["mean"], dtype=float), np.asarray(d["std"], dtype=float))

    def save(self, path) -> None:
        with open(path, "w") as f:
            json.dump(self.to_dict(), f)

    @classmethod
    def load(cls, path) -> "Scaler":
        with open(path) as f:
            return cls.from_dict(json.load(f))
