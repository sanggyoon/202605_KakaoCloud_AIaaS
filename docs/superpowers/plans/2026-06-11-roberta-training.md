# 하이브리드 RoBERTa 학습 (Valence + Arousal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** vm5 라벨(scene_scores)을 정답으로, 씬 텍스트+숫자피처를 입력받아 arousal·valence를 예측하는 하이브리드 RoBERTa 회귀 모델을 학습하고 산출물을 vm5 PVC에 저장한다.

**Architecture:** `4K_ML/train/` 새 패키지 — vm5 REST로 영화별 데이터를 끌어와 영화 단위 분할, RoBERTa(CLS)⊕숫자피처(z-score)→MLP→sigmoid 2-출력을 커스텀 PyTorch 루프(fp16)로 풀 파인튜닝. test 셋으로 MAE·영화내 Spearman·Pearson 평가 후 가중치/스케일러/설정/split을 PVC에 저장하고 `model_versions.metrics`에 기록. Argo GPU 워크플로로 실행.

**Tech Stack:** PyTorch(베이스 이미지), transformers(RoBERTa), scipy.stats(상관), httpx(vm5 REST), pytest. T4 16GB.

**Spec:** `docs/superpowers/specs/2026-06-11-roberta-training-design.md`

**Working dir:** 모든 `pytest`/`python`은 `4K_ML/`. git은 저장소 루트. 현재 브랜치 `feat/e-roberta-training`.

> **테스트 환경 주의:** 이 태스크들의 테스트는 `torch`/`transformers`가 필요합니다(4K_ML Docker 베이스에 포함). 로컬에 없으면 `pip install torch transformers` 후 실행하거나, 컨테이너/venv에서 실행하세요. model 테스트는 다운로드 없이 소형 `RobertaConfig`로 구성합니다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `4K_ML/train/__init__.py` | 패키지 마커 |
| `4K_ML/train/features.py` | 씬 숫자피처 5개 산출(순수) + z-score `Scaler`(fit/transform/save/load) |
| `4K_ML/train/db.py` | vm5 REST: 라벨완료 영화목록, 영화별 scenes/dialogues/scene_scores 조립, model_versions upsert |
| `4K_ML/train/dataset.py` | `split_movies`(영화단위), `SceneDataset`(토크나이즈+피처+타깃) |
| `4K_ML/train/model.py` | `HybridRobertaRegressor` + `build_encoder` |
| `4K_ML/train/evaluate.py` | `mae` / `pearson` / `movie_spearman` |
| `4K_ML/train/train_model.py` | `run()` 오케스트레이션(로드→분할→학습→평가→저장) |
| `4K_ML/tests/test_train_*.py` | 단위 테스트 |
| `4K_ML/requirements.txt` | transformers, safetensors 추가 |
| `4K_ML/Dockerfile` | `COPY train/` + roberta-base 베이킹 |
| `Ansible/manifests/4k-ml/pvc-models.yaml` | 모델 PVC(ns ai) |
| `Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml` | GPU 학습 워크플로(+PVC 마운트) |
| `.github/workflows/deploy-4k-ml.yml` | 새 WT 태그 bump |

---

## Task 1: 패키지 스캐폴드 + 의존성

**Files:**
- Create: `4K_ML/train/__init__.py`
- Modify: `4K_ML/requirements.txt`

- [ ] **Step 1: 패키지 마커**

`4K_ML/train/__init__.py` — 빈 파일.

- [ ] **Step 2: requirements 추가**

`4K_ML/requirements.txt`의 `anthropic==0.109.1` 다음 줄에 추가:
```
transformers==4.46.3
safetensors==0.4.5
```

- [ ] **Step 3: 설치/심볼 확인 (torch 있는 환경에서)**

Run: `python -c "import transformers, safetensors; from transformers import RobertaModel, RobertaConfig; print('ok')"`
Expected: `ok` (torch 미설치 시 먼저 `pip install torch transformers safetensors`)

- [ ] **Step 4: Commit**

```bash
git add 4K_ML/train/__init__.py 4K_ML/requirements.txt
git commit -m "build: train 패키지 스캐폴드 + transformers/safetensors"
```

---

## Task 2: features.py — 숫자 피처 + 스케일러

**Files:**
- Create: `4K_ML/train/features.py`
- Test: `4K_ML/tests/test_train_features.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_train_features.py`:

```python
import numpy as np

from train.features import compute_features, Scaler, FEATURE_ORDER


def test_feature_order():
    assert FEATURE_ORDER == ["progress_ratio", "scene_duration_s",
                             "dialogue_count", "words_per_sec", "avg_gap_before_ms"]


def test_compute_features_values():
    scene = {"progress_ratio": 0.5, "start_ms": 1000, "end_ms": 3000,
             "dialogue_count": 4, "text": "a b c d e f", "avg_gap_before_ms": 200.0}
    f = compute_features(scene)
    # duration = 2s, words = 6 → words_per_sec = 3.0
    assert f == [0.5, 2.0, 4.0, 3.0, 200.0]


def test_compute_features_zero_duration_guard():
    scene = {"progress_ratio": 0.0, "start_ms": 5000, "end_ms": 5000,
             "dialogue_count": 1, "text": "x", "avg_gap_before_ms": 0.0}
    f = compute_features(scene)
    assert f[1] == 1.0 and f[3] == 1.0  # duration floored at 1s, words_per_sec=1/1


def test_scaler_fit_transform_and_roundtrip(tmp_path):
    X = [[0.0, 2.0, 4.0, 3.0, 200.0], [1.0, 4.0, 8.0, 6.0, 0.0]]
    sc = Scaler().fit(X)
    Z = sc.transform(X)
    assert np.allclose(Z.mean(axis=0), 0.0, atol=1e-9)
    p = tmp_path / "scaler.json"
    sc.save(p)
    sc2 = Scaler.load(p)
    assert np.allclose(sc2.transform(X), Z)


def test_scaler_zero_std_no_nan():
    X = [[1.0], [1.0], [1.0]]  # std 0 → 1로 대체, nan 없음
    sc = Scaler().fit(X)
    assert not np.isnan(sc.transform(X)).any()
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_train_features.py -q`
Expected: FAIL (ModuleNotFoundError: train.features)

- [ ] **Step 3: 구현**

`4K_ML/train/features.py`:

```python
"""씬 숫자 피처(5개) + z-score 스케일러 (순수/직렬화 가능)."""
import json

import numpy as np

FEATURE_ORDER = ["progress_ratio", "scene_duration_s", "dialogue_count",
                 "words_per_sec", "avg_gap_before_ms"]


def compute_features(scene: dict) -> list[float]:
    """scene raw dict → FEATURE_ORDER 순서의 5-벡터."""
    dur_s = max((scene["end_ms"] - scene["start_ms"]) / 1000.0, 1.0)
    words = len((scene.get("text") or "").split())
    return [
        float(scene.get("progress_ratio") or 0.0),
        dur_s,
        float(scene.get("dialogue_count") or 0),
        words / dur_s,
        float(scene.get("avg_gap_before_ms") or 0.0),
    ]


class Scaler:
    """z-score 표준화. fit으로 mean/std 학습, transform 적용, json 직렬화."""

    def __init__(self, mean=None, std=None):
        self.mean = mean
        self.std = std

    def fit(self, X) -> "Scaler":
        arr = np.asarray(X, dtype=float)
        self.mean = arr.mean(axis=0)
        self.std = arr.std(axis=0)
        self.std = np.where(self.std == 0, 1.0, self.std)
        return self

    def transform(self, X) -> np.ndarray:
        arr = np.asarray(X, dtype=float)
        return (arr - self.mean) / self.std

    def to_dict(self) -> dict:
        return {"mean": [float(x) for x in self.mean],
                "std": [float(x) for x in self.std],
                "features": FEATURE_ORDER}

    @classmethod
    def from_dict(cls, d: dict) -> "Scaler":
        return cls(np.asarray(d["mean"], dtype=float), np.asarray(d["std"], dtype=float))

    def save(self, path) -> None:
        with open(path, "w") as f:
            json.dump(self.to_dict(), f)

    @classmethod
    def load(cls, path) -> "Scaler":
        with open(path) as f:
            return cls.from_dict(json.load(f))
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_train_features.py -q`
Expected: PASS (5개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/train/features.py 4K_ML/tests/test_train_features.py
git commit -m "feat(train): 씬 숫자피처 + z-score 스케일러"
```

---

## Task 3: db.py — vm5 학습 데이터 조회

**Files:**
- Create: `4K_ML/train/db.py`
- Test: `4K_ML/tests/test_train_db.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_train_db.py`:

```python
import json

import httpx

from train import db


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _env(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")


def test_fetch_labeled_movies(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        return httpx.Response(200, json=[
            {"tmdb_id": 1, "label_state": "done"},
            {"tmdb_id": 2, "label_state": "pending"},
            {"tmdb_id": 3, "label_state": "done"},
        ])

    assert db.fetch_labeled_movies(_client(handler)) == [1, 3]


def test_fetch_movie_scenes_assembles(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        u = str(req.url)
        if "/subtitles" in u:
            return httpx.Response(200, json=[{"id": 50}])
        if "/scenes" in u:
            return httpx.Response(200, json=[
                {"id": 100, "scene_index": 0, "text": "a b", "progress_ratio": 0.1,
                 "start_ms": 0, "end_ms": 2000, "dialogue_count": 2},
                {"id": 101, "scene_index": 1, "text": "c", "progress_ratio": 0.9,
                 "start_ms": 3000, "end_ms": 4000, "dialogue_count": 1},
            ])
        if "/dialogues" in u:
            return httpx.Response(200, json=[
                {"scenes_id": 100, "gap_before_ms": 100},
                {"scenes_id": 100, "gap_before_ms": 300},
                {"scenes_id": 101, "gap_before_ms": None},
            ])
        if "/scene_scores" in u:
            return httpx.Response(200, json=[
                {"scenes_id": 100, "score": 0.8, "model_version": db.LABEL_AROUSAL},
                {"scenes_id": 100, "score": 0.2, "model_version": db.LABEL_VALENCE},
                {"scenes_id": 101, "score": 0.5, "model_version": db.LABEL_AROUSAL},
                # 101 valence 없음 → 제외 대상
            ])
        return httpx.Response(404)

    recs = db.fetch_movie_scenes(_client(handler), 7)
    # scene 100만 두 축 모두 있음
    assert len(recs) == 1
    r = recs[0]
    assert r["movie_id"] == 7 and r["scenes_id"] == 100
    assert r["arousal"] == 0.8 and r["valence"] == 0.2
    assert r["avg_gap_before_ms"] == 200.0  # (100+300)/2


def test_upsert_model_version_payload(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.upsert_model_version(_client(handler), "roberta-va-v1", "roberta-regressor",
                            {"mae_arousal": 0.1})
    assert "on_conflict=model_version" in seen["url"]
    assert seen["body"][0]["model_version"] == "roberta-va-v1"
    assert seen["body"][0]["metrics"] == {"mae_arousal": 0.1}
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_train_db.py -q`
Expected: FAIL (ModuleNotFoundError: train.db)

- [ ] **Step 3: 구현**

`4K_ML/train/db.py`:

```python
"""vm5 REST — 학습 데이터 조회(영화별) + model_versions 기록."""
import os

import httpx

LABEL_AROUSAL = "llm-va-v1::arousal"
LABEL_VALENCE = "llm-va-v1::valence"


def _ai() -> tuple[str, str]:
    return os.getenv("AI_DATABASE_URL", ""), os.getenv("AI_DATABASE_KEY", "")


def _auth():
    user = os.getenv("AI_BASIC_USER")
    return (user, os.getenv("AI_BASIC_PASS", "")) if user else None


def _headers(write: bool = False) -> dict:
    _, key = _ai()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if write:
        h["Content-Type"] = "application/json"
        h["Prefer"] = "resolution=merge-duplicates,return=minimal"
    return h


def _get(client: httpx.Client, table: str, params: dict) -> list[dict]:
    url, _ = _ai()
    r = client.get(f"{url}/rest/v1/{table}", params=params,
                   headers=_headers(), auth=_auth(), timeout=60)
    r.raise_for_status()
    return r.json()


def fetch_labeled_movies(client: httpx.Client) -> list[int]:
    """label_state='done'인 tmdb_id 목록."""
    rows = _get(client, "processing_status",
                {"select": "tmdb_id,label_state", "limit": "1000000"})
    return [row["tmdb_id"] for row in rows if row.get("label_state") == "done"]


def fetch_movie_scenes(client: httpx.Client, tmdb_id: int) -> list[dict]:
    """영화 1편의 학습 레코드. 두 축 라벨이 모두 있는 씬만 반환.

    반환 dict: movie_id, scenes_id, scene_index, text, progress_ratio,
               start_ms, end_ms, dialogue_count, avg_gap_before_ms, arousal, valence
    """
    subs = _get(client, "subtitles", {"select": "id", "tmdb_id": f"eq.{tmdb_id}", "limit": "1"})
    if not subs:
        return []
    sid = subs[0]["id"]
    scenes = _get(client, "scenes",
                  {"select": "id,scene_index,text,progress_ratio,start_ms,end_ms,dialogue_count",
                   "subtitles_id": f"eq.{sid}", "order": "scene_index", "limit": "100000"})
    if not scenes:
        return []
    dials = _get(client, "dialogues",
                 {"select": "scenes_id,gap_before_ms", "subtitles_id": f"eq.{sid}",
                  "limit": "1000000"})
    ids = ",".join(str(s["id"]) for s in scenes)
    scores = _get(client, "scene_scores",
                  {"select": "scenes_id,score,model_version", "scenes_id": f"in.({ids})",
                   "model_version": f'in.("{LABEL_AROUSAL}","{LABEL_VALENCE}")', "limit": "1000000"})

    # 씬별 gap 평균(None 제외)
    gaps: dict[int, list[float]] = {}
    for d in dials:
        g = d.get("gap_before_ms")
        if g is not None:
            gaps.setdefault(d["scenes_id"], []).append(float(g))
    # 씬별 라벨
    label: dict[tuple[int, str], float] = {}
    for s in scores:
        label[(s["scenes_id"], s["model_version"])] = s["score"]

    out = []
    for s in scenes:
        a = label.get((s["id"], LABEL_AROUSAL))
        v = label.get((s["id"], LABEL_VALENCE))
        if a is None or v is None:
            continue
        glist = gaps.get(s["id"], [])
        out.append({
            "movie_id": tmdb_id, "scenes_id": s["id"], "scene_index": s["scene_index"],
            "text": s.get("text"), "progress_ratio": s.get("progress_ratio"),
            "start_ms": s["start_ms"], "end_ms": s["end_ms"],
            "dialogue_count": s.get("dialogue_count") or 0,
            "avg_gap_before_ms": (sum(glist) / len(glist)) if glist else 0.0,
            "arousal": a, "valence": v,
        })
    return out


def upsert_model_version(client: httpx.Client, model_version: str, kind: str, metrics: dict) -> None:
    url, _ = _ai()
    row = {"model_version": model_version, "kind": kind, "metrics": metrics}
    r = client.post(f"{url}/rest/v1/model_versions", params={"on_conflict": "model_version"},
                    json=[row], headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"model_versions upsert 실패 {r.status_code}: {r.text[:200]}")
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_train_db.py -q`
Expected: PASS (3개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/train/db.py 4K_ML/tests/test_train_db.py
git commit -m "feat(train): vm5 학습 데이터 조회 + model_versions 기록"
```

---

## Task 4: dataset.py — 영화단위 분할 + Dataset

**Files:**
- Create: `4K_ML/train/dataset.py`
- Test: `4K_ML/tests/test_train_dataset.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_train_dataset.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_train_dataset.py -q`
Expected: FAIL (ModuleNotFoundError: train.dataset)

- [ ] **Step 3: 구현**

`4K_ML/train/dataset.py`:

```python
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
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_train_dataset.py -q`
Expected: PASS (2개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/train/dataset.py 4K_ML/tests/test_train_dataset.py
git commit -m "feat(train): 영화단위 분할 + SceneDataset"
```

---

## Task 5: model.py — 하이브리드 회귀 모델

**Files:**
- Create: `4K_ML/train/model.py`
- Test: `4K_ML/tests/test_train_model_arch.py`

- [ ] **Step 1: 실패 테스트 작성** (소형 RobertaConfig — 다운로드 없음)

`4K_ML/tests/test_train_model_arch.py`:

```python
import torch
from transformers import RobertaConfig, RobertaModel

from train.model import HybridRobertaRegressor


def _tiny_encoder():
    cfg = RobertaConfig(vocab_size=50265, hidden_size=32, num_hidden_layers=2,
                        num_attention_heads=2, intermediate_size=64, max_position_embeddings=64)
    return RobertaModel(cfg)


def test_forward_shape_and_range():
    model = HybridRobertaRegressor(_tiny_encoder(), num_numeric=5, hidden=16)
    b = 3
    input_ids = torch.randint(0, 100, (b, 10))
    attn = torch.ones((b, 10), dtype=torch.long)
    numeric = torch.randn(b, 5)
    out = model(input_ids, attn, numeric)
    assert out.shape == (b, 2)
    assert float(out.min()) >= 0.0 and float(out.max()) <= 1.0  # sigmoid
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_train_model_arch.py -q`
Expected: FAIL (ModuleNotFoundError: train.model)

- [ ] **Step 3: 구현**

`4K_ML/train/model.py`:

```python
"""하이브리드 RoBERTa 회귀: 텍스트(CLS) ⊕ 숫자피처 → MLP → sigmoid 2-출력."""
import torch
import torch.nn as nn


class HybridRobertaRegressor(nn.Module):
    def __init__(self, encoder, num_numeric: int = 5, hidden: int = 256, dropout: float = 0.1):
        super().__init__()
        self.encoder = encoder
        dim = encoder.config.hidden_size
        self.head = nn.Sequential(
            nn.Linear(dim + num_numeric, hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, 2),
            nn.Sigmoid(),
        )

    def forward(self, input_ids, attention_mask, numeric):
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        cls = out.last_hidden_state[:, 0]          # <s> 토큰
        h = torch.cat([cls, numeric], dim=1)
        return self.head(h)


def build_encoder(name: str = "roberta-base"):
    from transformers import RobertaModel
    return RobertaModel.from_pretrained(name)
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_train_model_arch.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/train/model.py 4K_ML/tests/test_train_model_arch.py
git commit -m "feat(train): HybridRobertaRegressor (텍스트⊕숫자 → 2출력)"
```

---

## Task 6: evaluate.py — 지표

**Files:**
- Create: `4K_ML/train/evaluate.py`
- Test: `4K_ML/tests/test_train_evaluate.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_train_evaluate.py`:

```python
from train.evaluate import mae, pearson, movie_spearman


def test_mae():
    assert mae([0.0, 1.0], [0.5, 0.5]) == 0.5


def test_pearson_perfect():
    assert pearson([1.0, 2.0, 3.0], [2.0, 4.0, 6.0]) > 0.999


def test_pearson_constant_returns_zero():
    assert pearson([1.0, 1.0, 1.0], [1.0, 2.0, 3.0]) == 0.0


def test_movie_spearman_averages_per_movie():
    # movie 1: 완벽 단조 → rho 1.0 ; movie 2: 단일 씬 → 제외
    pred = [0.1, 0.2, 0.3, 0.9]
    true = [0.0, 0.5, 0.7, 0.4]
    movies = [1, 1, 1, 2]
    assert abs(movie_spearman(pred, true, movies) - 1.0) < 1e-9
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_train_evaluate.py -q`
Expected: FAIL (ModuleNotFoundError: train.evaluate)

- [ ] **Step 3: 구현**

`4K_ML/train/evaluate.py`:

```python
"""평가 지표: MAE, Pearson, 영화내 Spearman."""
import numpy as np
from scipy.stats import pearsonr, spearmanr


def mae(pred, true) -> float:
    p = np.asarray(pred, dtype=float)
    t = np.asarray(true, dtype=float)
    return float(np.mean(np.abs(p - t)))


def pearson(pred, true) -> float:
    p = np.asarray(pred, dtype=float)
    t = np.asarray(true, dtype=float)
    if len(p) < 2 or np.std(p) == 0 or np.std(t) == 0:
        return 0.0
    return float(pearsonr(p, t)[0])


def movie_spearman(pred, true, movie_ids) -> float:
    """영화별 Spearman 상관의 평균(씬 2개 미만 또는 상수 영화는 제외)."""
    by: dict = {}
    for p, t, m in zip(pred, true, movie_ids):
        by.setdefault(m, ([], []))
        by[m][0].append(p)
        by[m][1].append(t)
    vals = []
    for ps, ts in by.values():
        if len(ps) < 2 or np.std(ps) == 0 or np.std(ts) == 0:
            continue
        rho = spearmanr(ps, ts).statistic
        if not np.isnan(rho):
            vals.append(rho)
    return float(np.mean(vals)) if vals else 0.0
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_train_evaluate.py -q`
Expected: PASS (4개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/train/evaluate.py 4K_ML/tests/test_train_evaluate.py
git commit -m "feat(train): 평가 지표(MAE/Pearson/영화내 Spearman)"
```

---

## Task 7: train_model.py — 오케스트레이션

**Files:**
- Create: `4K_ML/train/train_model.py`
- Test: `4K_ML/tests/test_train_main.py`

- [ ] **Step 1: 실패 테스트 작성** (소형 인코더 + 가짜 토크나이저로 1 epoch)

`4K_ML/tests/test_train_main.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_train_main.py -q`
Expected: FAIL (ModuleNotFoundError: train.train_model)

- [ ] **Step 3: 구현**

`4K_ML/train/train_model.py`:

```python
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
                "spearman_movie_arousal": evaluate.movie_spearman(list(preds[:, 0]), list(true[:, 0]), mids),
                "pearson_arousal": evaluate.pearson(preds[:, 0], true[:, 0]),
                "pearson_valence": evaluate.pearson(preds[:, 1], true[:, 1]),
                "n_test": len(te_rec),
            }
        else:
            metrics = {"mae_arousal": None, "mae_valence": None,
                       "spearman_movie_arousal": None, "pearson_arousal": None,
                       "pearson_valence": None, "n_test": 0}

        _save(out_dir, model, tok, scaler,
              {"train": tr, "val": va, "test": te},
              {"model_version": MODEL_VERSION, "model_name": model_name,
               "lr": lr, "batch_size": batch_size, "seed": seed, "max_len": max_len})
        db.upsert_model_version(client, MODEL_VERSION, "roberta-regressor", metrics)
        print("metrics:", metrics)
        return metrics


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_train_main.py -q`
Expected: PASS (CPU에서 1 epoch, 소형 모델 — 수 초)

- [ ] **Step 5: 전체 회귀**

Run: `python -m pytest tests/test_train_features.py tests/test_train_db.py tests/test_train_dataset.py tests/test_train_model_arch.py tests/test_train_evaluate.py tests/test_train_main.py -q`
Expected: 전체 PASS

- [ ] **Step 6: Commit**

```bash
git add 4K_ML/train/train_model.py 4K_ML/tests/test_train_main.py
git commit -m "feat(train): 학습 오케스트레이션 run()(분할→학습→평가→PVC저장)"
```

---

## Task 8: 배포 — Dockerfile · PVC · WorkflowTemplate · CI

**Files:**
- Modify: `4K_ML/Dockerfile`
- Create: `Ansible/manifests/4k-ml/pvc-models.yaml`
- Create: `Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml`
- Modify: `.github/workflows/deploy-4k-ml.yml`

- [ ] **Step 1: Dockerfile — train COPY + roberta-base 베이킹**

`4K_ML/Dockerfile`에서 `COPY labeling/ ./labeling/` 다음 줄에 추가:
```dockerfile
COPY train/ ./train/
```

그리고 all-MiniLM 베이킹 `RUN` 블록 **다음**에 roberta-base 베이킹 블록 추가:
```dockerfile
# roberta-base도 이미지에 굽기 (학습 시 런타임 HF 다운로드 제거).
RUN --mount=type=secret,id=hf_token \
    sh -c 'if [ -s /run/secrets/hf_token ]; then export HF_TOKEN="$(cat /run/secrets/hf_token)"; fi; \
    for i in 1 2 3 4 5; do \
      python -c "from transformers import RobertaModel, RobertaTokenizerFast; RobertaModel.from_pretrained(\"roberta-base\"); RobertaTokenizerFast.from_pretrained(\"roberta-base\")" && exit 0; \
      echo "HF roberta 재시도 $i/5 — 20초 대기"; sleep 20; \
    done; \
    echo "roberta-base 다운로드 5회 실패"; exit 1'
```

- [ ] **Step 2: PVC 매니페스트**

`Ansible/manifests/4k-ml/pvc-models.yaml`:
```yaml
# 학습 산출물 저장용 PVC (vm5 local-path). train이 쓰고 KServe(F)가 읽음.
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ml-models
  namespace: ai
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: local-path
  resources:
    requests:
      storage: 10Gi
```

- [ ] **Step 3: 학습 WorkflowTemplate (GPU + PVC 마운트)**

`Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml`:
```yaml
# RoBERTa 학습(E)을 vm5 GPU에서 실행. 산출물은 ml-models PVC(/models)에 저장.
# 제출: argo submit --from workflowtemplate/train-roberta -n ai
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: train-roberta
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
        command: ["python", "-m", "train.train_model"]
        env:
          - name: MODEL_OUT_DIR
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

- [ ] **Step 4: CI 태그 bump에 새 WT 추가**

`.github/workflows/deploy-4k-ml.yml`의 `Update image tag in WorkflowTemplate` 스텝 `run:` 블록 끝에 추가:
```yaml
          sed -i 's|image: ghcr.io/sanggyoon/4k-ml:.*|image: ghcr.io/sanggyoon/4k-ml:${{ steps.vars.outputs.sha }}|' \
            Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml
```
그리고 `Commit and push manifest update` 스텝의 `git add` 줄에 파일 추가:
```yaml
          git add Ansible/manifests/4k-ml/workflowtemplate-subtitle-parse.yaml Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml
```

- [ ] **Step 5: YAML 검증**

Run (저장소 루트):
```bash
python -c "import yaml; yaml.safe_load(open('Ansible/manifests/4k-ml/pvc-models.yaml')); yaml.safe_load(open('Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml')); print('yaml ok')"
```
Expected: `yaml ok`

- [ ] **Step 6: Commit**

```bash
git add 4K_ML/Dockerfile Ansible/manifests/4k-ml/pvc-models.yaml Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml .github/workflows/deploy-4k-ml.yml
git commit -m "build(train): Docker roberta 베이킹 + PVC + 학습 WorkflowTemplate + CI"
```

---

## 배포 후 수동 작업 (코드 외 — 사용자)

1. main 병합 + push → CI가 이미지 빌드(+roberta 베이킹) → WT 태그 bump → ArgoCD 동기화.
2. ArgoCD가 `ml-models` PVC와 `train-roberta` WorkflowTemplate를 ns `ai`에 생성하는지 확인: `kubectl get pvc,workflowtemplate -n ai`.
3. 학습 실행: Argo UI(ns ai, `train-roberta`) 또는 `argo submit --from workflowtemplate/train-roberta -n ai`.
4. 완료 후 `model_versions`에서 `roberta-va-v1` metrics 확인(MAE·영화내 Spearman). PVC `/models/roberta-va-v1/` 산출물 확인.
5. 지표가 납득되면 → 다음 서브프로젝트 F(KServe 서빙)로.

---

## Self-Review 결과

**Spec coverage:** §2 결정 전부 매핑 — 인코더/풀FT·융합 → Task5; 피처5·z-score → Task2; 분할80/10/10 영화단위·고정test → Task4·7; 타깃 pivot → Task3·7; PVC 저장 → Task7·8; 커스텀루프 fp16 조기종료 → Task7; 평가지표 → Task6·7; 재학습/승격(지표 기록) → Task3(upsert)·7(metrics); GPU 워크플로 → Task8. §6 리스크(truncation max_len, HF 베이킹) → Task4·8.

**Placeholder scan:** 모든 코드/명령 구체화. 테스트는 소형 RobertaConfig/가짜 토크나이저로 다운로드·GPU 없이 통과하도록 설계.

**Type consistency:** scene record 키(movie_id/scenes_id/text/progress_ratio/start_ms/end_ms/dialogue_count/avg_gap_before_ms/arousal/valence)가 db→features(compute_features)→dataset→train 전 구간 일치. `compute_features`는 FEATURE_ORDER 5개와 일치. `MODEL_VERSION="roberta-va-v1"`·`LABEL_AROUSAL/VALENCE` 상수가 db/train/test에서 동일. run() 시그니처(out_dir,model_name,max_epochs,batch_size,lr,patience,seed,max_len)와 test 호출 인자 일치. 모킹 지점(load_training_data/build_model/_load_tokenizer/db.upsert_model_version)이 train_model 내 정의와 일치.
```