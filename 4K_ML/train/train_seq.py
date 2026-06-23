#!/usr/bin/env python3
"""문맥 인지 시퀀스 VA 모델 학습(roberta-va-v2).

v1 인코더 동결 재사용 → 씬 임베딩 사전계산 → BiLSTM 헤드 학습(영화 단위, 마스킹 MSE).
env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*),
     MODEL_OUT_DIR(기본 /models/roberta-va-v2), V1_MODEL_DIR(기본 /models/roberta-va-v1)
"""
import json
import os

import numpy as np
import torch
from torch.utils.data import DataLoader

from train import db, evaluate
from train.dataset import (MovieSequenceDataset, collate_movies, group_by_movie,
                           split_movies)
from train.embed import compute_embeddings
from train.features import Scaler, compute_features
from train.model import SeqRobertaRegressor, build_encoder

MODEL_VERSION = "roberta-va-v2"


def load_training_data(client) -> list[dict]:
    records: list[dict] = []
    for mid in db.fetch_labeled_movies(client):
        records.extend(db.fetch_movie_scenes(client, mid))
    return records


def _load_tokenizer(name: str):
    from transformers import RobertaTokenizerFast
    return RobertaTokenizerFast.from_pretrained(name)


def _load_frozen_encoder(v1_dir: str, encoder_name: str):
    """roberta-base 위에 v1 산출물의 fine-tuned 인코더 가중치를 로드(없으면 base 그대로)."""
    encoder = build_encoder(encoder_name)
    path = os.path.join(v1_dir, "model.safetensors")
    if os.path.exists(path):
        from safetensors.torch import load_file
        sd = load_file(path)
        enc_sd = {k[len("encoder."):]: v for k, v in sd.items() if k.startswith("encoder.")}
        if enc_sd:
            encoder.load_state_dict(enc_sd)
            print(f"v1 인코더 로드: {path}")
    else:
        print(f"v1 인코더 없음({path}) → roberta-base 사용")
    return encoder


def _attach_embeddings(records, model, tok, device, max_len, batch_size=32):
    embs = compute_embeddings(model, tok, [r.get("text") or "" for r in records],
                              device, max_len=max_len, batch_size=batch_size)
    for r, e in zip(records, embs):
        r["emb"] = e


def masked_mse(pred, target, mask):
    """pred/target (B,T,2), mask (B,T) → 유효 씬만 MSE."""
    m = mask.unsqueeze(-1).float()
    se = ((pred - target) ** 2) * m
    denom = m.sum() * 2.0
    return se.sum() / denom if denom > 0 else se.sum() * 0.0


def _eval(model, movies, scaler, device):
    """movies(list[list[rec]]) → (preds, trues, movie_ids) 평탄화(유효 씬만)."""
    ds = MovieSequenceDataset(movies, scaler)
    dl = DataLoader(ds, batch_size=8, collate_fn=collate_movies)
    P, T, M = [], [], []
    model.eval()
    with torch.no_grad():
        for b in dl:
            out = model.seq_forward(b["embs"].to(device), b["numeric"].to(device),
                                    b["lengths"]).cpu().numpy()
            tgt = b["target"].numpy()
            for i, mid in enumerate(b["movie_ids"]):
                t = int(b["lengths"][i])
                for j in range(t):
                    P.append(out[i, j]); T.append(tgt[i, j]); M.append(mid)
    return np.array(P), np.array(T), M


def _metrics(model, movies, scaler, device) -> dict:
    if not movies:
        return {k: None for k in ("mae_arousal", "mae_valence", "spearman_movie_arousal",
                                  "spearman_movie_valence", "pearson_arousal",
                                  "pearson_valence")} | {"n_test": 0}
    P, Tt, M = _eval(model, movies, scaler, device)
    return {
        "mae_arousal": evaluate.mae(P[:, 0], Tt[:, 0]),
        "mae_valence": evaluate.mae(P[:, 1], Tt[:, 1]),
        "spearman_movie_arousal": evaluate.movie_spearman(list(P[:, 0]), list(Tt[:, 0]), M),
        "spearman_movie_valence": evaluate.movie_spearman(list(P[:, 1]), list(Tt[:, 1]), M),
        "pearson_arousal": evaluate.pearson(P[:, 0], Tt[:, 0]),
        "pearson_valence": evaluate.pearson(P[:, 1], Tt[:, 1]),
        "n_test": len(P),
    }


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


def run(out_dir=None, v1_dir=None, encoder_name="roberta-base", max_epochs=20,
        batch_size=8, lr=1e-3, patience=3, seed=42, max_len=512,
        proj=256, lstm_hidden=256, lstm_layers=2, dropout=0.2) -> dict:
    if not os.getenv("AI_DATABASE_URL"):
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")
    out_dir = out_dir or os.getenv("MODEL_OUT_DIR", "/models/roberta-va-v2")
    v1_dir = v1_dir or os.getenv("V1_MODEL_DIR", "/models/roberta-va-v1")
    torch.manual_seed(seed)
    np.random.seed(seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    import httpx
    with httpx.Client(timeout=60) as client:
        records = load_training_data(client)
        if not records:
            raise SystemExit("학습 레코드 없음 (라벨 데이터 확인).")
        movie_ids = sorted({r["movie_id"] for r in records})
        tr, va, te = split_movies(movie_ids, seed=seed)

        tok = _load_tokenizer(encoder_name)
        encoder = _load_frozen_encoder(v1_dir, encoder_name)
        model = SeqRobertaRegressor(encoder, proj=proj, lstm_hidden=lstm_hidden,
                                    lstm_layers=lstm_layers, dropout=dropout).to(device)

        # 임베딩 사전계산(전 레코드)
        _attach_embeddings(records, model, tok, device, max_len)

        tr_set, va_set, te_set = set(tr), set(va), set(te)
        tr_recs = [r for r in records if r["movie_id"] in tr_set]
        scaler = Scaler().fit([compute_features(r) for r in tr_recs])

        tr_movies = group_by_movie(tr_recs)
        va_movies = group_by_movie([r for r in records if r["movie_id"] in va_set])
        te_movies = group_by_movie([r for r in records if r["movie_id"] in te_set])

        dl_tr = DataLoader(MovieSequenceDataset(tr_movies, scaler), batch_size=batch_size,
                           shuffle=True, collate_fn=collate_movies)
        opt = torch.optim.AdamW(model.head_parameters(), lr=lr, weight_decay=0.01)

        best = -1.0  # val movie-Spearman(평균 2축) 최대화
        best_state = None
        bad = 0
        for ep in range(max_epochs):
            model.train()
            for b in dl_tr:
                opt.zero_grad()
                pred = model.seq_forward(b["embs"].to(device), b["numeric"].to(device), b["lengths"])
                loss = masked_mse(pred, b["target"].to(device), b["mask"].to(device))
                loss.backward()
                opt.step()
            vm = _metrics(model, va_movies, scaler, device)
            vscore = (vm["spearman_movie_arousal"] + vm["spearman_movie_valence"]) / 2 \
                if vm["spearman_movie_arousal"] is not None else -1.0
            print(f"epoch {ep} val_spearman={vscore:.4f} "
                  f"(a={vm['spearman_movie_arousal']}, v={vm['spearman_movie_valence']})")
            if vscore > best + 1e-4:
                best = vscore
                best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                bad = 0
            else:
                bad += 1
                if bad >= patience:
                    print(f"조기종료 (epoch {ep})")
                    break
        if best_state:
            model.load_state_dict(best_state)

        metrics = _metrics(model, te_movies, scaler, device)
        config = {"model_version": MODEL_VERSION, "model_kind": "seq",
                  "encoder_name": encoder_name, "num_numeric": 5, "proj": proj,
                  "lstm_hidden": lstm_hidden, "lstm_layers": lstm_layers, "dropout": dropout,
                  "max_len": max_len, "lr": lr, "seed": seed, "v1_dir": v1_dir}
        _save(out_dir, model, tok, scaler, {"train": tr, "val": va, "test": te}, config)
        db.upsert_model_version(client, MODEL_VERSION, "seq-roberta-regressor", metrics)
        print("metrics:", metrics)
        return metrics


if __name__ == "__main__":
    run()
