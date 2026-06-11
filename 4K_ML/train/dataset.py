"""영화 단위 분할 + 토치 Dataset(텍스트 토큰 + 숫자피처 + 타깃)."""
import random

import torch
from torch.utils.data import Dataset

from train.features import compute_features


def split_movies(movie_ids, seed: int = 42, ratios=(0.8, 0.1, 0.1)):
    """영화 id를 train/val/test로 분할(같은 영화는 한 split에만)."""
    ids = sorted(movie_ids)
    random.Random(seed).shuffle(ids)
    n = len(ids)
    n_tr = int(n * ratios[0])
    n_va = int(n * ratios[1])
    return ids[:n_tr], ids[n_tr:n_tr + n_va], ids[n_tr + n_va:]


class SceneDataset(Dataset):
    def __init__(self, records: list[dict], tokenizer, scaler, max_len: int = 512):
        self.records = records
        self.tok = tokenizer
        self.max_len = max_len
        self.numeric = (scaler.transform([compute_features(r) for r in records])
                        if records else [])

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, i: int) -> dict:
        r = self.records[i]
        enc = self.tok(r.get("text") or "", truncation=True, max_length=self.max_len,
                       padding="max_length", return_tensors="pt")
        return {
            "input_ids": enc["input_ids"].squeeze(0),
            "attention_mask": enc["attention_mask"].squeeze(0),
            "numeric": torch.tensor(self.numeric[i], dtype=torch.float),
            "target": torch.tensor([r["arousal"], r["valence"]], dtype=torch.float),
            "movie_id": r["movie_id"],
        }
