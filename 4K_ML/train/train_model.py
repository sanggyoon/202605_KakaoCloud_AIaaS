#!/usr/bin/env python3
"""하이브리드 RoBERTa 학습 — vm5 라벨 → 모델 산출물(PVC) + model_versions 기록.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*), MODEL_OUT_DIR(기본 /models/roberta-va-v1)
"""
import json
import os

import numpy as np
import torch
from torch.utils.data import DataLoader

from train import db, evaluate
from train.dataset import SceneDataset, split_movies
from train.features import Scaler, compute_features
from train.model import HybridRobertaRegressor, build_encoder

MODEL_VERSION = "roberta-va-v1"


def load_training_data(client) -> list[dict]:
    """라벨 완료 영화 전체의 학습 레코드(두 축 라벨 보유 씬만)."""
    records: list[dict] = []
    for mid in db.fetch_labeled_movies(client):
        records.extend(db.fetch_movie_scenes(client, mid))
    return records


def build_model(name: str) -> HybridRobertaRegressor:
    return HybridRobertaRegressor(build_encoder(name))


def _load_tokenizer(name: str):
    from transformers import RobertaTokenizerFast
    return RobertaTokenizerFast.from_pretrained(name)


def _records_for(records, movie_set):
    return [r for r in records if r["movie_id"] in movie_set]


def _predict(model, records, tok, scaler, device, batch_size, max_len):
    model.eval()
    ds = SceneDataset(records, tok, scaler, max_len=max_len)
    dl = DataLoader(ds, batch_size=batch_size)
    preds = []
    with torch.no_grad():
        for b in dl:
            out = model(b["input_ids"].to(device), b["attention_mask"].to(device),
                        b["numeric"].to(device))
            preds.append(out.cpu().numpy())
    return np.concatenate(preds) if preds else np.zeros((0, 2))


def _val_mae(model, records, tok, scaler, device, batch_size, max_len) -> float:
    if not records:
        return float("inf")
    preds = _predict(model, records, tok, scaler, device, batch_size, max_len)
    true = np.array([[r["arousal"], r["valence"]] for r in records])
    return evaluate.mae(preds, true)


def _save(out_dir, model, tok, scaler, split, config):
    from safetensors.torch import save_file
    os.makedirs(out_dir, exist_ok=True)
    save_file({k: v.contiguous() for k, v in model.state_dict().items()},
              os.path.join(out_dir, "model.safetensors"))
    scaler.save(os.path.join(out_dir, "scaler.json"))
    with open(os.path.join(out_dir, "split.json"), "w") as f:
        json.dump(split, f)
    with open(os.path.join(out_dir, "config.json"), "w") as f:
        json.dump(config, f)
    tok.save_pretrained(out_dir)


def run(out_dir=None, model_name="roberta-base", max_epochs=10, batch_size=16,
        lr=2e-5, patience=2, seed=42, max_len=512) -> dict:
    if not os.getenv("AI_DATABASE_URL"):
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")
    out_dir = out_dir or os.getenv("MODEL_OUT_DIR", "/models/roberta-va-v1")
    torch.manual_seed(seed)
    np.random.seed(seed)

    import httpx
    with httpx.Client(timeout=60, verify=False) as client:
        records = load_training_data(client)
        if not records:
            raise SystemExit("학습 레코드 없음 (라벨 데이터 확인).")
        movie_ids = sorted({r["movie_id"] for r in records})
        tr, va, te = split_movies(movie_ids, seed=seed)
        tr_rec = _records_for(records, set(tr))
        va_rec = _records_for(records, set(va))
        te_rec = _records_for(records, set(te))

        scaler = Scaler().fit([compute_features(r) for r in tr_rec])
        tok = _load_tokenizer(model_name)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = build_model(model_name).to(device)

        dl_tr = DataLoader(SceneDataset(tr_rec, tok, scaler, max_len=max_len),
                           batch_size=batch_size, shuffle=True)
        opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
        amp_on = device == "cuda"
        gscaler = torch.amp.GradScaler("cuda", enabled=amp_on)
        lossfn = torch.nn.MSELoss()

        best = float("inf")
        best_state = None
        bad = 0
        for ep in range(max_epochs):
            model.train()
            for b in dl_tr:
                opt.zero_grad()
                with torch.amp.autocast("cuda", enabled=amp_on):
                    pred = model(b["input_ids"].to(device), b["attention_mask"].to(device),
                                 b["numeric"].to(device))
                    loss = lossfn(pred, b["target"].to(device))
                gscaler.scale(loss).backward()
                gscaler.step(opt)
                gscaler.update()
            vmae = _val_mae(model, va_rec, tok, scaler, device, batch_size, max_len)
            print(f"epoch {ep} val_mae={vmae:.4f}")
            if vmae < best - 1e-4:
                best = vmae
                best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                bad = 0
            else:
                bad += 1
                if bad >= patience:
                    print(f"조기종료 (epoch {ep})")
                    break
        if best_state:
            model.load_state_dict(best_state)

        # test 평가
        if te_rec:
            preds = _predict(model, te_rec, tok, scaler, device, batch_size, max_len)
            true = np.array([[r["arousal"], r["valence"]] for r in te_rec])
            mids = [r["movie_id"] for r in te_rec]
            metrics = {
                "mae_arousal": evaluate.mae(preds[:, 0], true[:, 0]),
                "mae_valence": evaluate.mae(preds[:, 1], true[:, 1]),
                "spearman_movie_arousal": evaluate.movie_spearman(
                    list(preds[:, 0]), list(true[:, 0]), mids),
                "spearman_movie_valence": evaluate.movie_spearman(
                    list(preds[:, 1]), list(true[:, 1]), mids),
                "pearson_arousal": evaluate.pearson(preds[:, 0], true[:, 0]),
                "pearson_valence": evaluate.pearson(preds[:, 1], true[:, 1]),
                "n_test": len(te_rec),
            }
        else:
            metrics = {"mae_arousal": None, "mae_valence": None,
                       "spearman_movie_arousal": None, "spearman_movie_valence": None,
                       "pearson_arousal": None, "pearson_valence": None, "n_test": 0}

        _save(out_dir, model, tok, scaler,
              {"train": tr, "val": va, "test": te},
              {"model_version": MODEL_VERSION, "model_name": model_name,
               "lr": lr, "batch_size": batch_size, "seed": seed, "max_len": max_len})
        db.upsert_model_version(client, MODEL_VERSION, "roberta-regressor", metrics)
        print("metrics:", metrics)
        return metrics


if __name__ == "__main__":
    run()
