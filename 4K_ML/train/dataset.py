"""영화 단위 분할 + 토치 Dataset(텍스트 토큰 + 숫자피처 + 타깃)."""
import random

import numpy as np
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


def group_by_movie(records: list[dict]) -> list[list[dict]]:
    """records를 movie_id별로 묶고 scene_index 오름차순 정렬한 영화 리스트로 반환."""
    by: dict = {}
    for r in records:
        by.setdefault(r["movie_id"], []).append(r)
    movies = []
    for recs in by.values():
        movies.append(sorted(recs, key=lambda r: r["scene_index"]))
    return movies


class MovieSequenceDataset(Dataset):
    """영화당 1 샘플. 각 record에 'emb'(사전계산 임베딩)가 부착돼 있어야 한다."""

    def __init__(self, movies: list[list[dict]], scaler):
        self.movies = movies
        self.scaler = scaler

    def __len__(self) -> int:
        return len(self.movies)

    def __getitem__(self, i: int) -> dict:
        recs = self.movies[i]
        embs = torch.tensor(np.stack([r["emb"] for r in recs]), dtype=torch.float)
        numeric = torch.tensor(
            self.scaler.transform([compute_features(r) for r in recs]), dtype=torch.float)
        target = torch.tensor([[r["arousal"], r["valence"]] for r in recs], dtype=torch.float)
        return {"embs": embs, "numeric": numeric, "target": target,
                "length": len(recs), "movie_id": recs[0]["movie_id"]}


def collate_movies(batch: list[dict]) -> dict:
    """가변 길이 영화 시퀀스 패딩 + 마스크."""
    lengths = torch.tensor([b["length"] for b in batch], dtype=torch.long)
    bsz = len(batch)
    t_max = int(lengths.max())
    enc_dim = batch[0]["embs"].shape[1]
    num_dim = batch[0]["numeric"].shape[1]
    embs = torch.zeros(bsz, t_max, enc_dim)
    numeric = torch.zeros(bsz, t_max, num_dim)
    target = torch.zeros(bsz, t_max, 2)
    mask = torch.zeros(bsz, t_max, dtype=torch.bool)
    movie_ids = []
    for i, b in enumerate(batch):
        t = b["length"]
        embs[i, :t] = b["embs"]
        numeric[i, :t] = b["numeric"]
        target[i, :t] = b["target"]
        mask[i, :t] = True
        movie_ids.append(b["movie_id"])
    return {"embs": embs, "numeric": numeric, "target": target,
            "lengths": lengths, "mask": mask, "movie_ids": movie_ids}
