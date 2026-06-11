import torch

from train.dataset import split_movies, SceneDataset
from train.features import Scaler, compute_features


def test_split_movies_no_overlap_and_reproducible():
    ids = list(range(100))
    tr, va, te = split_movies(ids, seed=42, ratios=(0.8, 0.1, 0.1))
    assert len(tr) == 80 and len(va) == 10 and len(te) == 10
    assert set(tr).isdisjoint(va) and set(tr).isdisjoint(te) and set(va).isdisjoint(te)
    assert set(tr) | set(va) | set(te) == set(ids)
    tr2, va2, te2 = split_movies(ids, seed=42)
    assert (tr, va, te) == (tr2, va2, te2)  # 시드 재현성


class _FakeTok:
    """RobertaTokenizer 대체 — 고정 길이 텐서 반환."""
    def __call__(self, text, truncation, max_length, padding, return_tensors):
        return {"input_ids": torch.ones((1, max_length), dtype=torch.long),
                "attention_mask": torch.ones((1, max_length), dtype=torch.long)}


def test_scene_dataset_item_shapes():
    recs = [
        {"movie_id": 1, "text": "a b c", "progress_ratio": 0.2, "start_ms": 0, "end_ms": 1000,
         "dialogue_count": 1, "avg_gap_before_ms": 0.0, "arousal": 0.7, "valence": 0.3},
        {"movie_id": 1, "text": "d e", "progress_ratio": 0.8, "start_ms": 0, "end_ms": 2000,
         "dialogue_count": 2, "avg_gap_before_ms": 100.0, "arousal": 0.1, "valence": 0.6},
    ]
    scaler = Scaler().fit([compute_features(r) for r in recs])
    ds = SceneDataset(recs, _FakeTok(), scaler, max_len=8)
    assert len(ds) == 2
    item = ds[0]
    assert item["input_ids"].shape == (8,)
    assert item["attention_mask"].shape == (8,)
    assert item["numeric"].shape == (5,)
    assert torch.allclose(item["target"], torch.tensor([0.7, 0.3]))
    assert item["movie_id"] == 1
