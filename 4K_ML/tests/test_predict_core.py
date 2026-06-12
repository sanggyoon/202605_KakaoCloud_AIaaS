import torch
from transformers import RobertaConfig, RobertaModel

from serving.predict_core import score_instances
from train.model import HybridRobertaRegressor
from train.features import Scaler, compute_features


class _FakeTok:
    def __call__(self, texts, truncation, max_length, padding, return_tensors):
        b = len(texts)
        return {"input_ids": torch.ones((b, max_length), dtype=torch.long),
                "attention_mask": torch.ones((b, max_length), dtype=torch.long)}


def _tiny_model():
    cfg = RobertaConfig(vocab_size=50265, hidden_size=32, num_hidden_layers=1,
                        num_attention_heads=2, intermediate_size=64, max_position_embeddings=64)
    return HybridRobertaRegressor(RobertaModel(cfg), num_numeric=5, hidden=16)


def _inst(text, prog, dur_ms, dcount, gap):
    return {"text": text, "progress_ratio": prog, "start_ms": 0, "end_ms": dur_ms,
            "dialogue_count": dcount, "avg_gap_before_ms": gap}


def test_score_instances_shape_and_range():
    insts = [_inst("a b c", 0.2, 2000, 2, 100.0), _inst("d e", 0.8, 1000, 1, 0.0)]
    scaler = Scaler().fit([compute_features(x) for x in insts])
    out = score_instances(_tiny_model(), scaler, _FakeTok(), 8, insts)
    assert len(out) == 2
    for o in out:
        assert set(o) == {"arousal", "valence"}
        assert 0.0 <= o["arousal"] <= 1.0 and 0.0 <= o["valence"] <= 1.0


def test_score_instances_empty():
    scaler = Scaler().fit([[0, 0, 0, 0, 0]])
    assert score_instances(_tiny_model(), scaler, _FakeTok(), 8, []) == []
