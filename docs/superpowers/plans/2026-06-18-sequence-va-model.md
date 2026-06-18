# 문맥 인지 시퀀스 VA 모델 `roberta-va-v2` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v1 인코더를 동결 재사용해 씬 임베딩을 사전계산하고, 그 위 BiLSTM으로 영화 시퀀스 문맥을 반영하는 `roberta-va-v2`를 학습·서빙해 영화내 Spearman(특히 valence)을 높인다.

**Architecture:** 동결 RoBERTa(v1) → 씬 CLS 임베딩(768) ⊕ 숫자 5피처 → Linear 사영 → BiLSTM(양방향) → 씬별 Sigmoid 2출력. 학습은 임베딩 사전계산 후 BiLSTM 헤드만 학습(영화 단위 시퀀스, 마스킹 MSE). 서빙은 동일 모델로 영화의 정렬 씬을 한 번에 추론. 신버전은 A/B 후 더 좋을 때만 promote.

**Tech Stack:** PyTorch, transformers(RoBERTa), safetensors, httpx(vm5 REST), Argo Workflows(GPU), KServe(FastAPI predictor).

## Global Constraints

- 작업 디렉토리: `4K_ML/`. 모듈 임포트는 `from train import ...`, `from serving import ...` 패턴.
- 테스트 러너 없음 → 검증 = `python -m py_compile <module>` + (torch 환경 있으면) CPU 형상 스모크 1회. 결정적 검증은 GPU 학습 잡의 metrics vs v1.
- 라벨 재사용: `llm-va-v1::arousal`/`::valence` (train/db.py 상수). 신규 라벨 없음.
- 인코더 **동결**: v1 산출물(`/models/roberta-va-v1`)의 fine-tuned 인코더 가중치를 로드해 frozen 사용.
- 신버전 문자열: `roberta-va-v2`. 산출물엔 전체 모델(동결 인코더+BiLSTM 헤드)을 함께 저장 → 서빙 자기완결.
- v1 베이스라인(같은 test split): MAE a/v 0.0878/0.0899, Pearson 0.796/0.738, **movie-Spearman 0.751/0.660**.
- 성공 기준: 같은 test split에서 **valence movie-Spearman ≥ 0.70**, arousal ≥ 0.75, MAE는 v1 대비 +0.01 이내.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 작업 브랜치: `feat/seq-va-model` (이미 생성됨).

## File Structure

- **Modify** `4K_ML/train/model.py` — `SeqRobertaRegressor` 추가(동결 인코더 + BiLSTM 헤드).
- **Create** `4K_ML/train/embed.py` — 동결 인코더로 씬 CLS 임베딩 사전계산.
- **Modify** `4K_ML/train/dataset.py` — `group_by_movie`, `MovieSequenceDataset`, `collate_movies` 추가.
- **Create** `4K_ML/train/train_seq.py` — v2 학습 오케스트레이션(사전계산→헤드 학습→평가→저장→model_versions 기록).
- **Modify** `4K_ML/serving/predict_core.py` — `score_instances_seq` + `load_artifacts`의 seq 분기.
- **Modify** `4K_ML/serving/predictor.py` — cfg `model_kind`로 스코어러 선택.
- **Create** `Ansible/manifests/4k-ml/workflowtemplate-train-roberta-seq.yaml` — v2 학습 Argo 템플릿.
- **Create** `docs/roberta-va-v2-rollout.md` — A/B·promote·재스코어링 런북.

---

### Task 1: `SeqRobertaRegressor` 모델 클래스

**Files:**
- Modify: `4K_ML/train/model.py`

**Interfaces:**
- Consumes: `build_encoder(name)`(기존).
- Produces:
  - `class SeqRobertaRegressor(nn.Module)` with
    `__init__(self, encoder, num_numeric=5, proj=256, lstm_hidden=256, lstm_layers=2, dropout=0.2)`,
    `embed_scenes(self, input_ids, attention_mask) -> Tensor[N, enc_dim]`(no grad),
    `seq_forward(self, embs, numeric, lengths) -> Tensor[B, T, 2]`,
    `head_parameters(self) -> Iterator[Parameter]`(인코더 제외).

- [ ] **Step 1: 클래스 추가**

`4K_ML/train/model.py` 끝에 추가(기존 `HybridRobertaRegressor`/`build_encoder`는 그대로):

```python
class SeqRobertaRegressor(nn.Module):
    """동결 RoBERTa 임베딩 ⊕ 숫자피처 → BiLSTM → 씬별 sigmoid 2출력 (문맥 인지)."""

    def __init__(self, encoder, num_numeric: int = 5, proj: int = 256,
                 lstm_hidden: int = 256, lstm_layers: int = 2, dropout: float = 0.2):
        super().__init__()
        self.encoder = encoder
        for p in self.encoder.parameters():
            p.requires_grad = False
        enc_dim = encoder.config.hidden_size
        self.proj = nn.Linear(enc_dim + num_numeric, proj)
        self.lstm = nn.LSTM(proj, lstm_hidden, num_layers=lstm_layers, batch_first=True,
                            bidirectional=True, dropout=dropout if lstm_layers > 1 else 0.0)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(lstm_hidden * 2, 2), nn.Sigmoid())

    def embed_scenes(self, input_ids, attention_mask):
        """(N, L) 토큰 → (N, enc_dim) CLS 임베딩. 인코더 동결이라 grad 없음."""
        self.encoder.eval()
        with torch.no_grad():
            out = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        return out.last_hidden_state[:, 0]

    def seq_forward(self, embs, numeric, lengths):
        """embs (B,T,enc_dim), numeric (B,T,num_numeric), lengths (B,) → (B,T,2)."""
        x = torch.relu(self.proj(torch.cat([embs, numeric], dim=-1)))
        packed = nn.utils.rnn.pack_padded_sequence(
            x, lengths.cpu(), batch_first=True, enforce_sorted=False)
        out, _ = self.lstm(packed)
        out, _ = nn.utils.rnn.pad_packed_sequence(
            out, batch_first=True, total_length=embs.size(1))
        return self.head(out)

    def head_parameters(self):
        """학습 대상(인코더 제외): 사영·LSTM·출력 헤드."""
        for module in (self.proj, self.lstm, self.head):
            yield from module.parameters()
```

- [ ] **Step 2: 구문 검사**

Run: `cd 4K_ML && python -m py_compile train/model.py && echo "PY OK"`
Expected: `PY OK`

- [ ] **Step 3: (torch 환경 시) 형상 스모크**

임시 스크립트 `/tmp/sm1.py` 작성 후 실행:

```python
import torch
from transformers import RobertaConfig, RobertaModel
from train.model import SeqRobertaRegressor
enc = RobertaModel(RobertaConfig(hidden_size=64, num_hidden_layers=1, num_attention_heads=1,
                                 intermediate_size=64, max_position_embeddings=20, vocab_size=50))
m = SeqRobertaRegressor(enc, proj=16, lstm_hidden=8, lstm_layers=1)
embs = torch.randn(2, 5, 64); numeric = torch.randn(2, 5, 5); lengths = torch.tensor([5, 3])
out = m.seq_forward(embs, numeric, lengths)
assert out.shape == (2, 5, 2), out.shape
assert (out >= 0).all() and (out <= 1).all()
assert sum(p.requires_grad for p in enc.parameters()) == 0  # 인코더 동결
print("SHAPE OK", out.shape)
```

Run: `cd 4K_ML && PYTHONPATH=. python /tmp/sm1.py`
Expected: `SHAPE OK torch.Size([2, 5, 2])` (torch 미설치면 이 단계 생략, py_compile로 갈음)

- [ ] **Step 4: 커밋**

```bash
cd 4K_ML && git add train/model.py
git commit -m "$(printf 'feat(ml): SeqRobertaRegressor (동결 인코더 + BiLSTM 시퀀스 헤드)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: 임베딩 사전계산 (`train/embed.py`)

**Files:**
- Create: `4K_ML/train/embed.py`

**Interfaces:**
- Consumes: `SeqRobertaRegressor.embed_scenes`(Task 1).
- Produces: `compute_embeddings(model, tok, texts: list[str], device, max_len=512, batch_size=32) -> np.ndarray[N, enc_dim]`.

- [ ] **Step 1: 파일 작성**

`4K_ML/train/embed.py` 전체:

```python
"""동결 인코더로 씬 텍스트 → CLS 임베딩 사전계산 (학습 가속용)."""
import numpy as np
import torch


def compute_embeddings(model, tok, texts, device, max_len: int = 512,
                       batch_size: int = 32) -> np.ndarray:
    """texts(list[str]) → (N, enc_dim) CLS 임베딩. 동결 인코더라 grad 없음."""
    if not texts:
        return np.zeros((0, model.encoder.config.hidden_size), dtype=np.float32)
    model.eval()
    chunks = []
    for i in range(0, len(texts), batch_size):
        part = [t or "" for t in texts[i:i + batch_size]]
        enc = tok(part, truncation=True, max_length=max_len, padding="max_length",
                  return_tensors="pt")
        e = model.embed_scenes(enc["input_ids"].to(device), enc["attention_mask"].to(device))
        chunks.append(e.cpu().numpy())
    return np.concatenate(chunks).astype(np.float32)
```

- [ ] **Step 2: 구문 검사**

Run: `cd 4K_ML && python -m py_compile train/embed.py && echo "PY OK"`
Expected: `PY OK`

- [ ] **Step 3: (torch 환경 시) 형상 스모크**

`/tmp/sm2.py`:
```python
import torch
from transformers import RobertaConfig, RobertaModel, RobertaTokenizerFast
from train.model import SeqRobertaRegressor
from train.embed import compute_embeddings
enc = RobertaModel(RobertaConfig(hidden_size=64, num_hidden_layers=1, num_attention_heads=1,
                                 intermediate_size=64, max_position_embeddings=20, vocab_size=50))
m = SeqRobertaRegressor(enc, proj=16, lstm_hidden=8, lstm_layers=1)
tok = RobertaTokenizerFast.from_pretrained("roberta-base")
embs = compute_embeddings(m, tok, ["hello world", "foo", ""], "cpu", max_len=16, batch_size=2)
assert embs.shape == (3, 64), embs.shape
print("EMB OK", embs.shape)
```
Run: `cd 4K_ML && PYTHONPATH=. python /tmp/sm2.py`
Expected: `EMB OK (3, 64)` (torch/네트워크 없으면 생략)

- [ ] **Step 4: 커밋**

```bash
cd 4K_ML && git add train/embed.py
git commit -m "$(printf 'feat(ml): 씬 임베딩 사전계산 모듈(embed)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: 영화 시퀀스 Dataset + collate (`train/dataset.py`)

**Files:**
- Modify: `4K_ML/train/dataset.py`

**Interfaces:**
- Consumes: `compute_features`(기존), `Scaler`(features).
- Produces:
  - `group_by_movie(records) -> list[list[dict]]` (영화별, scene_index 오름차순; 각 record엔 `emb`(np.ndarray) 부착돼 있어야 함).
  - `class MovieSequenceDataset(Dataset)`: `__init__(self, movies, scaler)`; item = `{embs(T,E), numeric(T,5), target(T,2), length:int, movie_id}`.
  - `collate_movies(batch) -> {embs(B,T,E), numeric(B,T,5), target(B,T,2), lengths(B,), mask(B,T bool), movie_ids:list}`.

- [ ] **Step 1: 추가 코드**

`4K_ML/train/dataset.py` 끝에 추가(기존 `split_movies`/`SceneDataset`는 그대로). 상단 import에 `import numpy as np` 추가:

```python
import numpy as np  # (상단 import 블록에 없으면 추가)


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
```

- [ ] **Step 2: 구문 검사**

Run: `cd 4K_ML && python -m py_compile train/dataset.py && echo "PY OK"`
Expected: `PY OK`

- [ ] **Step 3: (torch 환경 시) 형상 스모크**

`/tmp/sm3.py`:
```python
import numpy as np, torch
from train.features import Scaler
from train.dataset import group_by_movie, MovieSequenceDataset, collate_movies
recs = []
for mid in (1, 2):
    for si in range(4 if mid == 1 else 2):
        recs.append({"movie_id": mid, "scene_index": si, "emb": np.zeros(8, dtype=np.float32),
                     "progress_ratio": 0.1 * si, "start_ms": si * 1000, "end_ms": si * 1000 + 800,
                     "dialogue_count": 1, "text": "x", "avg_gap_before_ms": 0.0,
                     "arousal": 0.5, "valence": 0.4})
movies = group_by_movie(recs)
assert len(movies) == 2 and len(movies[0]) in (4, 2)
from train.features import compute_features
sc = Scaler().fit([compute_features(r) for r in recs])
ds = MovieSequenceDataset(movies, sc)
batch = collate_movies([ds[0], ds[1]])
assert batch["embs"].shape[0] == 2 and batch["embs"].shape[2] == 8
assert batch["mask"].sum().item() == 6  # 4 + 2 유효 씬
print("DS OK", batch["embs"].shape, int(batch["mask"].sum()))
```
Run: `cd 4K_ML && PYTHONPATH=. python /tmp/sm3.py`
Expected: `DS OK torch.Size([2, 4, 8]) 6` (torch 없으면 생략)

- [ ] **Step 4: 커밋**

```bash
cd 4K_ML && git add train/dataset.py
git commit -m "$(printf 'feat(ml): 영화 시퀀스 Dataset + collate(패딩/마스크)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: v2 학습 스크립트 (`train/train_seq.py`)

**Files:**
- Create: `4K_ML/train/train_seq.py`

**Interfaces:**
- Consumes: `db`(fetch_labeled_movies/fetch_movie_scenes/upsert_model_version), `evaluate`, `split_movies`/`group_by_movie`/`MovieSequenceDataset`/`collate_movies`, `Scaler`/`compute_features`, `SeqRobertaRegressor`/`build_encoder`, `compute_embeddings`.
- Produces: `run(...) -> dict(metrics)`; 산출물 디렉터리(전체 모델/scaler/config/split/토크나이저) + `model_versions["roberta-va-v2"]` 기록.

- [ ] **Step 1: 파일 작성**

`4K_ML/train/train_seq.py` 전체:

```python
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
            mask = b["mask"].numpy()
            tgt = b["target"].numpy()
            for i, mid in enumerate(b["movie_ids"]):
                t = int(b["lengths"][i])
                for j in range(t):
                    P.append(out[i, j]); T.append(tgt[i, j]); M.append(mid)
    return np.array(P), np.array(T), M


def _metrics(model, movies, scaler, device) -> dict:
    if not movies:
        return {k: None for k in ("mae_arousal", "mae_valence", "spearman_movie_arousal",
                                  "spearman_movie_valence", "pearson_arousal", "pearson_valence")} | {"n_test": 0}
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
    with httpx.Client(timeout=60, verify=False) as client:
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
```

- [ ] **Step 2: 구문 검사**

Run: `cd 4K_ML && python -m py_compile train/train_seq.py && echo "PY OK"`
Expected: `PY OK`

- [ ] **Step 3: 커밋**

```bash
cd 4K_ML && git add train/train_seq.py
git commit -m "$(printf 'feat(ml): roberta-va-v2 시퀀스 학습 스크립트(train_seq)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

> 실제 학습(GPU)·metrics 검증은 Task 6 런북에서 Argo 잡으로 수행한다.

---

### Task 5: 서빙 시퀀스 추론 (`serving/predict_core.py`, `predictor.py`)

**Files:**
- Modify: `4K_ML/serving/predict_core.py`
- Modify: `4K_ML/serving/predictor.py`

**Interfaces:**
- Consumes: `SeqRobertaRegressor`/`build_encoder`(Task 1), `Scaler`/`compute_features`.
- Produces: `score_instances_seq(model, scaler, tokenizer, max_len, instances) -> list[{arousal,valence}]`; `load_artifacts`가 cfg `model_kind=="seq"`면 `SeqRobertaRegressor` 로드.

- [ ] **Step 1: predict_core.py 수정**

import 라인에 `SeqRobertaRegressor` 추가:

```python
from train.model import HybridRobertaRegressor, SeqRobertaRegressor, build_encoder
```

`load_artifacts`를 cfg 기반 분기로 교체:

```python
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
```

파일 끝에 시퀀스 스코어러 추가:

```python
def score_instances_seq(model, scaler, tokenizer, max_len: int, instances: list[dict]) -> list[dict]:
    """한 영화의 scene_index 순 인스턴스 전체를 하나의 시퀀스로 추론 → 씬별 점수."""
    if not instances:
        return []
    import torch
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
```

> 주의: 시퀀스 모델은 **scene_index 순서**가 중요하다. `serving/db.py`의 `fetch_movie_scenes_for_scoring`는 이미 `order=scene_index`로 조회하므로 호출부 변경 불필요.

- [ ] **Step 2: predictor.py 수정 (model_kind로 스코어러 선택)**

import 교체:

```python
from serving.predict_core import load_artifacts, score_instances, score_instances_seq
```

`_load`에서 cfg로 스코어러 결정 후 state에 저장하고, `predict`가 그걸 사용하도록 교체:

```python
    @app.on_event("startup")
    def _load():
        model_dir = os.getenv("MODEL_DIR", "/mnt/models")
        model, scaler, tok, cfg = loader(model_dir)
        scorer = score_instances_seq if cfg.get("model_kind") == "seq" else score_instances
        state.update({
            "model": model, "scaler": scaler, "tok": tok,
            "max_len": int(cfg.get("max_len", 512)),
            "model_version": cfg.get("model_version", "roberta-va-v1"),
            "scorer": scorer,
            "ready": True,
        })
```

```python
    @app.post("/v1/models/" + MODEL_NAME + ":predict")
    def predict(req: PredictRequest):
        preds = state["scorer"](state["model"], state["scaler"], state["tok"],
                                state["max_len"], req.instances)
        return {"predictions": preds, "model_version": state["model_version"]}
```

- [ ] **Step 3: 구문 검사**

Run: `cd 4K_ML && python -m py_compile serving/predict_core.py serving/predictor.py && echo "PY OK"`
Expected: `PY OK`

- [ ] **Step 4: 커밋**

```bash
cd 4K_ML && git add serving/predict_core.py serving/predictor.py
git commit -m "$(printf 'feat(ml): 서빙 시퀀스 추론 분기(model_kind=seq)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: 학습 Argo 템플릿 + 롤아웃 런북

**Files:**
- Create: `Ansible/manifests/4k-ml/workflowtemplate-train-roberta-seq.yaml`
- Create: `docs/roberta-va-v2-rollout.md`

**Interfaces:**
- Consumes: `train.train_seq`(Task 4), `serving.promote`(기존 A/B 판단), 기존 score/vectors 템플릿.
- Produces: v2 학습 잡 + 롤아웃 절차 문서.

- [ ] **Step 1: 학습 WorkflowTemplate 작성**

`Ansible/manifests/4k-ml/workflowtemplate-train-roberta-seq.yaml` 전체 (기존 `train-roberta` 템플릿과 동일 구조, 명령/경로만 v2):

```yaml
# RoBERTa 시퀀스 모델(roberta-va-v2) 학습 — vm5 GPU. 산출물 ml-models PVC(/models/roberta-va-v2).
# 제출: argo submit --from workflowtemplate/train-roberta-seq -n ai
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: train-roberta-seq
  namespace: ai
spec:
  serviceAccountName: argo-workflow
  podSpecPatch: |
    runtimeClassName: nvidia
  entrypoint: main
  volumes:
    - name: models
      persistentVolumeClaim:
        claimName: ml-models
  templates:
    - name: main
      nodeSelector:
        workload: gpu
      container:
        image: ghcr.io/sanggyoon/4k-ml:latest
        command: ["python", "-m", "train.train_seq"]
        env:
          - name: MODEL_OUT_DIR
            value: /models/roberta-va-v2
          - name: V1_MODEL_DIR
            value: /models/roberta-va-v1
        envFrom:
          - secretRef:
              name: 4k-ml-secrets
        volumeMounts:
          - name: models
            mountPath: /models
        resources:
          limits:
            nvidia.com/gpu: 1
```

> 이미지 태그: 이 코드가 머지되면 CI가 `ghcr.io/sanggyoon/4k-ml:<sha>`를 빌드한다. 운영 적용 시
> `latest` 대신 해당 sha로 고정 권장(기존 `train-roberta` 템플릿이 sha를 박는 패턴과 동일).

- [ ] **Step 2: 롤아웃 런북 작성**

`docs/roberta-va-v2-rollout.md` 전체:

```markdown
# roberta-va-v2 롤아웃 런북

문맥 인지 시퀀스 모델을 학습→A/B→promote→재스코어링→벡터 재생성하는 절차.
**promote 전까지 운영(FE)은 v1 그대로** — 안전.

## 0. 사전조건
- 코드(train_seq, 서빙 분기)가 main 머지 → CI가 `ghcr.io/sanggyoon/4k-ml:<sha>` 빌드.
- `workflowtemplate-train-roberta-seq.yaml`의 image를 그 `<sha>`로 설정 후 적용
  (`kubectl apply -f` 또는 ArgoCD 동기화). `/models/roberta-va-v1` 산출물 존재 확인.

## 1. v2 학습 (GPU)
```
argo submit --from workflowtemplate/train-roberta-seq -n ai --wait
```
완료 후 산출물 `/models/roberta-va-v2`, vm5 `model_versions["roberta-va-v2"]`에 metrics 기록.

## 2. A/B 비교 (승격 판단)
```
python -m serving.promote roberta-va-v1 roberta-va-v2
```
`serving/promote.decide`가 두 버전 metrics를 비교. **성공 기준**: v2의
movie-Spearman(valence ≥ 0.70, arousal ≥ 0.75), MAE는 v1 대비 +0.01 이내.
미달이면 중단하고 하이퍼파라미터(lstm_layers/proj/lr/조기종료 기준) 조정 후 1로 복귀.

## 3. 서빙 전환 (GitOps)
- KServe predictor의 `MODEL_DIR`이 `/models/roberta-va-v2`(또는 v2 심볼릭)를 보도록 매니페스트
  수정 → 배포. 서빙이 v2 모델·`model_version=roberta-va-v2`를 응답.

## 4. active 버전 전환
- vm5 `model_versions.active`를 base `roberta-va-v2`로 설정(v1 active=false).
  (재스코어링/벡터/FE가 active를 따른다.)

## 5. 전체 재스코어링 + 벡터 재생성
```
argo submit --from workflowtemplate/score-scenes-gpu -n ai --wait   # roberta-va-v2::arousal/::valence 적재
argo submit --from workflowtemplate/generate-vectors  -n ai --wait   # movie_vectors(roberta-va-v2::*) 생성
```
완료되면 FE `getActiveVersion`이 v2를 읽어 곡선/유사도에 자동 반영.

## 롤백
- `model_versions.active`를 v1로 되돌리고 predictor `MODEL_DIR`를 v1로 복구.
  v1 벡터(`roberta-va-v1::*`)는 남아 있으므로 즉시 복귀 가능.
```

- [ ] **Step 3: YAML 유효성 + 커밋**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project && python3 -c "import yaml; yaml.safe_load(open('Ansible/manifests/4k-ml/workflowtemplate-train-roberta-seq.yaml')); print('YAML OK')"`
Expected: `YAML OK`

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/manifests/4k-ml/workflowtemplate-train-roberta-seq.yaml docs/roberta-va-v2-rollout.md
git commit -m "$(printf 'feat(ml): v2 학습 Argo 템플릿 + 롤아웃 런북\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 완료 후

- `superpowers:finishing-a-development-branch`로 main 머지/PR 결정.
- **코드 머지 ≠ 모델 교체**: 머지는 train_seq/서빙 분기/템플릿만 들인다. 실제 v2 적용은
  런북(Task 6 Step 2)을 사람이 실행 — 학습→A/B 통과→promote 후에만 운영 반영.
- push 거부 시 `git fetch origin && git rebase origin/main` 후 재push.
```
