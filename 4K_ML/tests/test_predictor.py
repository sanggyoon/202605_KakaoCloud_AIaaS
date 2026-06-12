import torch
from fastapi.testclient import TestClient
from transformers import RobertaConfig, RobertaModel

from serving.predictor import create_app
from train.features import Scaler, compute_features
from train.model import HybridRobertaRegressor


class _FakeTok:
    def __call__(self, texts, truncation, max_length, padding, return_tensors):
        b = len(texts)
        return {"input_ids": torch.ones((b, max_length), dtype=torch.long),
                "attention_mask": torch.ones((b, max_length), dtype=torch.long)}


def _fake_loader(model_dir):
    cfg = RobertaConfig(vocab_size=50265, hidden_size=32, num_hidden_layers=1,
                        num_attention_heads=2, intermediate_size=64, max_position_embeddings=64)
    model = HybridRobertaRegressor(RobertaModel(cfg), num_numeric=5, hidden=16)
    inst = {"text": "a", "progress_ratio": 0.1, "start_ms": 0, "end_ms": 1000,
            "dialogue_count": 1, "avg_gap_before_ms": 0.0}
    scaler = Scaler().fit([compute_features(inst)])
    return model, scaler, _FakeTok(), {"max_len": 8, "model_version": "roberta-va-v1"}


def test_ready_and_predict():
    app = create_app(loader=_fake_loader)
    with TestClient(app) as client:  # context manager triggers startup(_load)
        r = client.get("/v1/models/roberta-va")
        assert r.status_code == 200 and r.json()["ready"] is True

        body = {"instances": [{"text": "he runs", "progress_ratio": 0.9, "start_ms": 0,
                               "end_ms": 2000, "dialogue_count": 3, "avg_gap_before_ms": 100.0}]}
        r = client.post("/v1/models/roberta-va:predict", json=body)
        assert r.status_code == 200
        j = r.json()
        assert j["model_version"] == "roberta-va-v1"
        assert len(j["predictions"]) == 1
        assert set(j["predictions"][0]) == {"arousal", "valence"}
        p = j["predictions"][0]
        assert 0.0 <= p["arousal"] <= 1.0 and 0.0 <= p["valence"] <= 1.0
