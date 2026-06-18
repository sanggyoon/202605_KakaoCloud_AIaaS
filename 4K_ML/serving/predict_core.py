"""KServe predictor 핵심 로직 (kserve 비의존, 테스트 가능).

학습과 동일한 train.features/train.model을 재사용해 train/serve 스큐를 차단한다.
"""
import json
import os

import numpy as np
import torch

from train.features import Scaler, compute_features
from train.model import HybridRobertaRegressor, SeqRobertaRegressor, build_encoder


def load_artifacts(model_dir: str, encoder_name: str = "roberta-base", device=None):
    """산출물 로드. config.model_kind=='seq'면 SeqRobertaRegressor, 아니면 Hybrid(v1)."""
    from safetensors.torch import load_file
    from transformers import RobertaTokenizerFast

    cfg = json.load(open(os.path.join(model_dir, "config.json")))
    scaler = Scaler.load(os.path.join(model_dir, "scaler.json"))
    tok = RobertaTokenizerFast.from_pretrained(model_dir)
    enc_name = cfg.get("encoder_name", encoder_name)
    if cfg.get("model_kind") == "seq":
        model = SeqRobertaRegressor(build_encoder(enc_name),
                                    num_numeric=cfg.get("num_numeric", 5),
                                    proj=cfg.get("proj", 256),
                                    lstm_hidden=cfg.get("lstm_hidden", 256),
                                    lstm_layers=cfg.get("lstm_layers", 2),
                                    dropout=cfg.get("dropout", 0.2))
    else:
        model = HybridRobertaRegressor(build_encoder(enc_name))
    model.load_state_dict(load_file(os.path.join(model_dir, "model.safetensors")))
    dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
    model.to(dev)
    model.eval()
    return model, scaler, tok, cfg


def _clamp01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def score_instances(model, scaler, tokenizer, max_len: int, instances: list[dict]) -> list[dict]:
    """원본 씬 필드 인스턴스 → [{arousal, valence}]. 학습과 동일 변환. 텐서는 모델 device로."""
    if not instances:
        return []
    dev = next(model.parameters()).device
    feats = scaler.transform([compute_features(x) for x in instances])
    enc = tokenizer([x.get("text") or "" for x in instances], truncation=True,
                    max_length=max_len, padding="max_length", return_tensors="pt")
    numeric = torch.tensor(np.asarray(feats), dtype=torch.float).to(dev)
    input_ids = enc["input_ids"].to(dev)
    attention_mask = enc["attention_mask"].to(dev)
    with torch.no_grad():
        out = model(input_ids, attention_mask, numeric).cpu().numpy()
    return [{"arousal": _clamp01(a), "valence": _clamp01(v)} for a, v in out]


def score_instances_seq(model, scaler, tokenizer, max_len: int, instances: list[dict]) -> list[dict]:
    """한 영화의 scene_index 순 인스턴스 전체를 하나의 시퀀스로 추론 → 씬별 점수."""
    if not instances:
        return []
    dev = next(model.parameters()).device
    feats = scaler.transform([compute_features(x) for x in instances])
    enc = tokenizer([x.get("text") or "" for x in instances], truncation=True,
                    max_length=max_len, padding="max_length", return_tensors="pt")
    with torch.no_grad():
        embs = model.embed_scenes(enc["input_ids"].to(dev), enc["attention_mask"].to(dev))  # (N,E)
        numeric = torch.tensor(np.asarray(feats), dtype=torch.float).to(dev)                # (N,5)
        lengths = torch.tensor([len(instances)], dtype=torch.long)
        out = model.seq_forward(embs.unsqueeze(0), numeric.unsqueeze(0), lengths)[0].cpu().numpy()
    return [{"arousal": _clamp01(a), "valence": _clamp01(v)} for a, v in out]
