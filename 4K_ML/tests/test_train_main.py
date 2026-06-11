import json

import torch
from transformers import RobertaConfig, RobertaModel

from train import train_model as tm
from train.model import HybridRobertaRegressor


class _FakeTok:
    def __call__(self, text, truncation, max_length, padding, return_tensors):
        return {"input_ids": torch.ones((1, max_length), dtype=torch.long),
                "attention_mask": torch.ones((1, max_length), dtype=torch.long)}

    def save_pretrained(self, path):
        import os
        os.makedirs(path, exist_ok=True)
        open(f"{path}/tokenizer.txt", "w").close()


def _rec(movie, idx, a, v):
    return {"movie_id": movie, "scenes_id": movie * 100 + idx, "scene_index": idx,
            "text": f"scene {idx} words here", "progress_ratio": idx / 5.0,
            "start_ms": idx * 1000, "end_ms": idx * 1000 + 2000,
            "dialogue_count": 2, "avg_gap_before_ms": 50.0, "arousal": a, "valence": v}


def _tiny_model():
    cfg = RobertaConfig(vocab_size=50265, hidden_size=32, num_hidden_layers=1,
                        num_attention_heads=2, intermediate_size=64, max_position_embeddings=64)
    return HybridRobertaRegressor(RobertaModel(cfg), num_numeric=5, hidden=16)


def test_run_trains_and_saves(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    # 10편 × 4씬 = 40 레코드 (분할 가능하도록)
    records = [_rec(m, i, 0.5, 0.4) for m in range(10) for i in range(4)]
    monkeypatch.setattr(tm, "load_training_data", lambda client: records)
    monkeypatch.setattr(tm, "build_model", lambda name: _tiny_model())
    monkeypatch.setattr(tm, "_load_tokenizer", lambda name: _FakeTok())

    upserts = {}
    monkeypatch.setattr(tm.db, "upsert_model_version",
                        lambda client, mv, kind, metrics: upserts.update(
                            {"mv": mv, "kind": kind, "metrics": metrics}))

    metrics = tm.run(out_dir=str(tmp_path / "model"), model_name="tiny",
                     max_epochs=1, batch_size=8, max_len=8)

    # 산출물 파일 생성 확인
    out = tmp_path / "model"
    assert (out / "scaler.json").exists()
    assert (out / "split.json").exists()
    assert (out / "config.json").exists()
    assert (out / "model.safetensors").exists()
    # metrics 기록 + 키 존재
    assert upserts["mv"] == tm.MODEL_VERSION
    for k in ("mae_arousal", "mae_valence", "spearman_movie_arousal", "n_test"):
        assert k in metrics
    # split이 영화단위로 저장됐는지
    split = json.loads((out / "split.json").read_text())
    assert set(split["train"]).isdisjoint(split["test"])
