# KServe 서빙 + 배치 스코어링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `roberta-va-v1`을 KServe(RawDeployment, CPU)로 서빙하고, Argo 배치 잡이 엔드포인트를 호출해 파싱된 모든 영화 씬을 점수화하여 `scene_scores`(roberta-va-v1::arousal/valence)에 적재한다.

**Architecture:** `4K_ML/serving/` — kserve 비의존 추론 코어(`predict_core`)를 kserve 커스텀 predictor(`predictor`/`serve`)가 감싼다. 배치 클라이언트(`score_scenes`)가 vm5에서 점수없는 영화를 골라 KServe predict를 호출하고 결과를 `scene_scores`에 멱등 적재(score_state). 승격 게이트 헬퍼(`promote`)는 model_versions 지표를 비교만 한다.

**Tech Stack:** KServe(RawDeployment), PyTorch/transformers(베이스 이미지), httpx, scipy, pytest. cert-manager·nginx 기존.

**Spec:** `docs/superpowers/specs/2026-06-12-kserve-serving-design.md`

**Working dir:** `pytest`/`python`은 `4K_ML/`. git은 저장소 루트. 현재 브랜치 `feat/f-kserve-serving`.

> **테스트 환경:** 단위 테스트는 `kserve` 불필요(코어/ db/ score/ promote만 검증). `kserve`는 이미지 빌드 시에만 필요. 테스트엔 torch/transformers/scipy 필요(이미 로컬 설치됨; Docker 베이스 포함).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `4K_ML/serving/__init__.py` | 패키지 마커 |
| `4K_ML/serving/predict_core.py` | **kserve 비의존** — 산출물 로드 + 인스턴스 점수화(순수) |
| `4K_ML/serving/predictor.py` | `VAPredictor(kserve.Model)` 래퍼 |
| `4K_ML/serving/serve.py` | `kserve.ModelServer` 진입점 |
| `4K_ML/serving/db.py` | vm5 REST: 대상/씬조회·model_versions·scene_scores·score_state |
| `4K_ML/serving/score_scenes.py` | 배치 클라이언트 `run()` (KServe 호출 → 적재) |
| `4K_ML/serving/promote.py` | 승격 게이트 `decide()` + CLI |
| `4K_ML/tests/test_predict_core.py` 등 | 단위 테스트 |
| `4K_ML/requirements.txt` | `kserve` 추가 |
| `4K_ML/Dockerfile` | `COPY serving/` |
| `Ansible/manifests/4k-ml/inferenceservice-roberta-va.yaml` | InferenceService(RawDeployment, CPU, PVC 마운트) |
| `Ansible/manifests/4k-ml/workflowtemplate-score-scenes.yaml` | 스코어링 배치 WT |
| `.github/workflows/deploy-4k-ml.yml` | 새 WT 태그 bump |

---

## Task 1: 패키지 스캐폴드 + kserve 의존성

**Files:**
- Create: `4K_ML/serving/__init__.py`
- Modify: `4K_ML/requirements.txt`

- [ ] **Step 1: 패키지 마커** — `4K_ML/serving/__init__.py` 빈 파일.

- [ ] **Step 2: requirements에 kserve 추가**

`4K_ML/requirements.txt`의 `safetensors==0.4.5` 다음 줄에 추가:
```
kserve==0.13.1
```

- [ ] **Step 3: 비-kserve 임포트만 동작 확인** (kserve는 이미지에서만 설치)

Run: `python -c "import torch, transformers, scipy, safetensors; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add 4K_ML/serving/__init__.py 4K_ML/requirements.txt
git commit -m "build: serving 패키지 스캐폴드 + kserve 의존성"
```

---

## Task 2: predict_core.py — 추론 코어 (kserve 비의존)

**Files:**
- Create: `4K_ML/serving/predict_core.py`
- Test: `4K_ML/tests/test_predict_core.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_predict_core.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_predict_core.py -q`
Expected: FAIL (ModuleNotFoundError: serving.predict_core)

- [ ] **Step 3: 구현**

`4K_ML/serving/predict_core.py`:

```python
"""KServe predictor 핵심 로직 (kserve 비의존, 테스트 가능).

학습과 동일한 train.features/train.model을 재사용해 train/serve 스큐를 차단한다.
"""
import json
import os

import numpy as np
import torch

from train.features import Scaler, compute_features
from train.model import HybridRobertaRegressor, build_encoder


def load_artifacts(model_dir: str, encoder_name: str = "roberta-base"):
    """산출물 디렉터리에서 모델/스케일러/토크나이저/설정 로드."""
    from safetensors.torch import load_file
    from transformers import RobertaTokenizerFast

    cfg = json.load(open(os.path.join(model_dir, "config.json")))
    scaler = Scaler.load(os.path.join(model_dir, "scaler.json"))
    tok = RobertaTokenizerFast.from_pretrained(model_dir)
    model = HybridRobertaRegressor(build_encoder(encoder_name))
    model.load_state_dict(load_file(os.path.join(model_dir, "model.safetensors")))
    model.eval()
    return model, scaler, tok, cfg


def _clamp01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def score_instances(model, scaler, tokenizer, max_len: int, instances: list[dict]) -> list[dict]:
    """원본 씬 필드 인스턴스 → [{arousal, valence}]. 학습과 동일 변환."""
    if not instances:
        return []
    feats = scaler.transform([compute_features(x) for x in instances])
    enc = tokenizer([x.get("text") or "" for x in instances], truncation=True,
                    max_length=max_len, padding="max_length", return_tensors="pt")
    numeric = torch.tensor(np.asarray(feats), dtype=torch.float)
    with torch.no_grad():
        out = model(enc["input_ids"], enc["attention_mask"], numeric).cpu().numpy()
    return [{"arousal": _clamp01(a), "valence": _clamp01(v)} for a, v in out]
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_predict_core.py -q`
Expected: PASS (2개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/serving/predict_core.py 4K_ML/tests/test_predict_core.py
git commit -m "feat(serving): 추론 코어 score_instances/load_artifacts (kserve 비의존)"
```

---

## Task 3: predictor.py + serve.py — KServe 래퍼

**Files:**
- Create: `4K_ML/serving/predictor.py`
- Create: `4K_ML/serving/serve.py`

> kserve가 로컬에 없으므로 단위 테스트는 없음. 코어(Task 2)가 검증되며, 래퍼는 이미지 빌드/런타임에서 동작. 임포트 오류만 없게 작성.

- [ ] **Step 1: predictor.py 작성**

`4K_ML/serving/predictor.py`:

```python
"""KServe 커스텀 predictor — predict_core를 kserve.Model로 감싼다."""
import os

import kserve

from serving.predict_core import load_artifacts, score_instances


class VAPredictor(kserve.Model):
    def __init__(self, name: str):
        super().__init__(name)
        self.name = name
        self.ready = False
        self.model = None
        self.scaler = None
        self.tokenizer = None
        self.max_len = 512
        self.model_version = "roberta-va-v1"

    def load(self):
        model_dir = os.getenv("MODEL_DIR", "/mnt/models")
        self.model, self.scaler, self.tokenizer, cfg = load_artifacts(model_dir)
        self.max_len = int(cfg.get("max_len", 512))
        self.model_version = cfg.get("model_version", "roberta-va-v1")
        self.ready = True

    def predict(self, payload, headers=None):
        instances = payload.get("instances", []) if isinstance(payload, dict) else []
        preds = score_instances(self.model, self.scaler, self.tokenizer, self.max_len, instances)
        return {"predictions": preds, "model_version": self.model_version}
```

- [ ] **Step 2: serve.py 작성**

`4K_ML/serving/serve.py`:

```python
"""KServe ModelServer 진입점 — `python -m serving.serve`."""
import kserve

from serving.predictor import VAPredictor

if __name__ == "__main__":
    model = VAPredictor("roberta-va")
    model.load()
    kserve.ModelServer().start([model])
```

- [ ] **Step 3: 구문 점검** (kserve 미설치라 임포트는 못 하지만 파싱 확인)

Run: `python -m py_compile serving/predictor.py serving/serve.py && echo "compile ok"`
Expected: `compile ok`

- [ ] **Step 4: Commit**

```bash
git add 4K_ML/serving/predictor.py 4K_ML/serving/serve.py
git commit -m "feat(serving): KServe 커스텀 predictor + ModelServer 진입점"
```

---

## Task 4: serving/db.py — vm5 스코어링 REST

**Files:**
- Create: `4K_ML/serving/db.py`
- Test: `4K_ML/tests/test_serving_db.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_serving_db.py`:

```python
import json

import httpx

from serving import db


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _env(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")


def test_fetch_score_targets(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        return httpx.Response(200, json=[
            {"tmdb_id": 1, "parse_state": "done", "score_state": "pending"},
            {"tmdb_id": 2, "parse_state": "done", "score_state": "done"},
            {"tmdb_id": 3, "parse_state": "pending", "score_state": "pending"},
        ])

    assert db.fetch_score_targets(_client(handler)) == [1]


def test_fetch_movie_scenes_for_scoring(monkeypatch):
    _env(monkeypatch)

    def handler(req):
        u = str(req.url)
        if "/subtitles" in u:
            return httpx.Response(200, json=[{"id": 50}])
        if "/scenes" in u:
            return httpx.Response(200, json=[
                {"id": 100, "scene_index": 0, "text": "a b", "progress_ratio": 0.1,
                 "start_ms": 0, "end_ms": 2000, "dialogue_count": 2},
            ])
        if "/dialogues" in u:
            return httpx.Response(200, json=[
                {"scenes_id": 100, "gap_before_ms": 100},
                {"scenes_id": 100, "gap_before_ms": 300},
            ])
        return httpx.Response(404)

    out = db.fetch_movie_scenes_for_scoring(_client(handler), 7)
    assert len(out) == 1
    r = out[0]
    assert r["scenes_id"] == 100 and r["scene_index"] == 0
    assert r["text"] == "a b" and r["avg_gap_before_ms"] == 200.0
    assert "arousal" not in r  # 라벨 없음(추론 대상)


def test_ensure_model_versions(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.ensure_model_versions(_client(handler), "roberta-va-v1")
    vers = {r["model_version"] for r in seen["body"]}
    assert vers == {"roberta-va-v1::arousal", "roberta-va-v1::valence"}
    assert "on_conflict=model_version" in seen["url"]


def test_upsert_scene_scores_and_state(monkeypatch):
    _env(monkeypatch)
    seen = {}

    def handler(req):
        seen.setdefault("urls", []).append(str(req.url))
        if req.method == "POST" and "scene_scores" in str(req.url):
            seen["scores"] = json.loads(req.content)
        if req.method == "POST" and "processing_status" in str(req.url):
            seen["state"] = json.loads(req.content)
        return httpx.Response(201, json=[])

    db.upsert_scene_scores(_client(handler), [{"scenes_id": 1, "score": 0.5,
                                               "model_version": "roberta-va-v1::arousal"}])
    db.set_score_state(_client(handler), 7, "done")
    assert any("on_conflict=scenes_id" in u for u in seen["urls"])
    assert seen["state"][0]["tmdb_id"] == 7 and seen["state"][0]["score_state"] == "done"
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_serving_db.py -q`
Expected: FAIL (ModuleNotFoundError: serving.db)

- [ ] **Step 3: 구현**

`4K_ML/serving/db.py`:

```python
"""vm5 REST — 스코어링 대상/씬 조회 + scene_scores/score_state 적재."""
import os
from datetime import datetime, timezone

import httpx


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


def fetch_score_targets(client: httpx.Client) -> list[int]:
    """parse_state='done' & score_state!='done'인 tmdb_id."""
    rows = _get(client, "processing_status",
                {"select": "tmdb_id,parse_state,score_state", "limit": "1000000"})
    return [r["tmdb_id"] for r in rows
            if r.get("parse_state") == "done" and r.get("score_state") != "done"]


def fetch_movie_scenes_for_scoring(client: httpx.Client, tmdb_id: int) -> list[dict]:
    """추론 입력용 씬(라벨 없음): scenes_id, scene_index + predict_core 인스턴스 필드."""
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
                 {"select": "scenes_id,gap_before_ms", "subtitles_id": f"eq.{sid}", "limit": "1000000"})
    gaps: dict[int, list[float]] = {}
    for d in dials:
        g = d.get("gap_before_ms")
        if g is not None:
            gaps.setdefault(d["scenes_id"], []).append(float(g))
    out = []
    for s in scenes:
        glist = gaps.get(s["id"], [])
        out.append({
            "scenes_id": s["id"], "scene_index": s["scene_index"],
            "text": s.get("text"), "progress_ratio": s.get("progress_ratio"),
            "start_ms": s["start_ms"], "end_ms": s["end_ms"],
            "dialogue_count": s.get("dialogue_count") or 0,
            "avg_gap_before_ms": (sum(glist) / len(glist)) if glist else 0.0,
        })
    return out


def ensure_model_versions(client: httpx.Client, model_version: str) -> None:
    """scene_scores FK용 축별 행 보장 (예: roberta-va-v1::arousal/valence)."""
    url, _ = _ai()
    rows = [
        {"model_version": f"{model_version}::arousal", "kind": "roberta-score",
         "description": f"{model_version} arousal prediction"},
        {"model_version": f"{model_version}::valence", "kind": "roberta-score",
         "description": f"{model_version} valence prediction"},
    ]
    r = client.post(f"{url}/rest/v1/model_versions", params={"on_conflict": "model_version"},
                    json=rows, headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"model_versions upsert 실패 {r.status_code}: {r.text[:200]}")


def upsert_scene_scores(client: httpx.Client, rows: list[dict]) -> None:
    url, _ = _ai()
    r = client.post(f"{url}/rest/v1/scene_scores", params={"on_conflict": "scenes_id,model_version"},
                    json=rows, headers=_headers(write=True), auth=_auth(), timeout=60)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"scene_scores upsert 실패 {r.status_code}: {r.text[:200]}")


def set_score_state(client: httpx.Client, tmdb_id: int, state: str, error: str | None = None) -> None:
    url, _ = _ai()
    row = {"tmdb_id": tmdb_id, "score_state": state, "error": error,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    r = client.post(f"{url}/rest/v1/processing_status", params={"on_conflict": "tmdb_id"},
                    json=[row], headers=_headers(write=True), auth=_auth(), timeout=30)
    if r.status_code not in (200, 201, 204):
        raise RuntimeError(f"score_state upsert 실패 {r.status_code}: {r.text[:200]}")
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_serving_db.py -q`
Expected: PASS (4개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/serving/db.py 4K_ML/tests/test_serving_db.py
git commit -m "feat(serving): vm5 스코어링 REST(대상/씬/model_versions/scene_scores/score_state)"
```

---

## Task 5: score_scenes.py — 배치 스코어링 클라이언트

**Files:**
- Create: `4K_ML/serving/score_scenes.py`
- Test: `4K_ML/tests/test_score_main.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_score_main.py`:

```python
from serving import score_scenes as sc
from serving import db


def test_run_scores_and_states(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("KSERVE_PREDICT_URL", "http://kserve/predict")

    monkeypatch.setattr(sc.db, "fetch_score_targets", lambda c: [7, 8])
    scenes_by = {
        7: [{"scenes_id": 100, "scene_index": 0, "text": "a", "progress_ratio": 0.1,
             "start_ms": 0, "end_ms": 1000, "dialogue_count": 1, "avg_gap_before_ms": 0.0}],
        8: [],
    }
    monkeypatch.setattr(sc.db, "fetch_movie_scenes_for_scoring", lambda c, t: scenes_by[t])

    captured = {"scores": [], "states": [], "ensured": []}
    monkeypatch.setattr(sc.db, "ensure_model_versions",
                        lambda c, mv: captured["ensured"].append(mv))
    monkeypatch.setattr(sc.db, "upsert_scene_scores",
                        lambda c, rows: captured["scores"].extend(rows))
    monkeypatch.setattr(sc.db, "set_score_state",
                        lambda c, t, s, e=None: captured["states"].append((t, s)))

    def fake_predict(url, instances):
        # 인스턴스 수만큼 예측 + 서빙 model_version 반환
        return {"predictions": [{"arousal": 0.8, "valence": 0.2} for _ in instances],
                "model_version": "roberta-va-v1"}

    monkeypatch.setattr(sc, "call_predictor", fake_predict)

    sc.run()

    assert captured["scores"] == [
        {"scenes_id": 100, "score": 0.8, "model_version": "roberta-va-v1::arousal"},
        {"scenes_id": 100, "score": 0.2, "model_version": "roberta-va-v1::valence"},
    ]
    assert (7, "done") in captured["states"]
    assert "roberta-va-v1" in captured["ensured"]


def test_run_flags_failed(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "https://ai.test")
    monkeypatch.setenv("KSERVE_PREDICT_URL", "http://kserve/predict")
    monkeypatch.setattr(sc.db, "fetch_score_targets", lambda c: [7])
    monkeypatch.setattr(sc.db, "fetch_movie_scenes_for_scoring", lambda c, t:
                        [{"scenes_id": 100, "scene_index": 0, "text": "a", "progress_ratio": 0.1,
                          "start_ms": 0, "end_ms": 1000, "dialogue_count": 1, "avg_gap_before_ms": 0.0}])
    monkeypatch.setattr(sc.db, "ensure_model_versions", lambda c, mv: None)
    monkeypatch.setattr(sc.db, "upsert_scene_scores", lambda c, rows: None)
    states = []
    monkeypatch.setattr(sc.db, "set_score_state", lambda c, t, s, e=None: states.append((t, s)))

    def boom(url, instances):
        raise RuntimeError("predict 500")

    monkeypatch.setattr(sc, "call_predictor", boom)
    sc.run()
    assert states == [(7, "failed")]
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_score_main.py -q`
Expected: FAIL (ModuleNotFoundError: serving.score_scenes)

- [ ] **Step 3: 구현**

`4K_ML/serving/score_scenes.py`:

```python
#!/usr/bin/env python3
"""배치 스코어링 — vm5 점수없는 영화 → KServe predict → scene_scores 적재.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*),
     KSERVE_PREDICT_URL(예: http://roberta-va-predictor.ai.svc.cluster.local/v1/models/roberta-va:predict)
"""
import os

import httpx

from serving import db


def call_predictor(url: str, instances: list[dict]) -> dict:
    """KServe predict 호출 → {"predictions":[...], "model_version":...}."""
    r = httpx.post(url, json={"instances": instances}, timeout=120)
    r.raise_for_status()
    return r.json()


def _clamp01(x) -> float:
    return float(min(1.0, max(0.0, float(x))))


def run() -> None:
    if not os.getenv("AI_DATABASE_URL"):
        raise SystemExit("AI_DATABASE_URL 환경변수가 필요합니다 (vm5).")
    predict_url = os.getenv("KSERVE_PREDICT_URL")
    if not predict_url:
        raise SystemExit("KSERVE_PREDICT_URL 환경변수가 필요합니다.")

    counts = {"done": 0, "failed": 0}
    ensured: set[str] = set()
    with httpx.Client(timeout=60, verify=False) as client:
        targets = db.fetch_score_targets(client)
        for tmdb_id in targets:
            try:
                scenes = db.fetch_movie_scenes_for_scoring(client, tmdb_id)
                if not scenes:
                    db.set_score_state(client, tmdb_id, "done")
                    counts["done"] += 1
                    continue
                instances = [{
                    "text": s["text"], "progress_ratio": s["progress_ratio"],
                    "start_ms": s["start_ms"], "end_ms": s["end_ms"],
                    "dialogue_count": s["dialogue_count"],
                    "avg_gap_before_ms": s["avg_gap_before_ms"],
                } for s in scenes]
                resp = call_predictor(predict_url, instances)
                mv = resp["model_version"]
                if mv not in ensured:
                    db.ensure_model_versions(client, mv)
                    ensured.add(mv)
                preds = resp["predictions"]
                rows = []
                for s, p in zip(scenes, preds):
                    rows.append({"scenes_id": s["scenes_id"], "score": _clamp01(p["arousal"]),
                                 "model_version": f"{mv}::arousal"})
                    rows.append({"scenes_id": s["scenes_id"], "score": _clamp01(p["valence"]),
                                 "model_version": f"{mv}::valence"})
                db.upsert_scene_scores(client, rows)
                db.set_score_state(client, tmdb_id, "done")
                counts["done"] += 1
                print(f"tmdb={tmdb_id} scenes_scored={len(scenes)} mv={mv}")
            except Exception as e:  # noqa: BLE001
                db.set_score_state(client, tmdb_id, "failed", str(e)[:500])
                counts["failed"] += 1
                print(f"tmdb={tmdb_id} FAILED: {e}")
    print(f"완료: {counts}")


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_score_main.py -q`
Expected: PASS (2개)

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/serving/score_scenes.py 4K_ML/tests/test_score_main.py
git commit -m "feat(serving): 배치 스코어링 클라이언트 run()(KServe 호출→scene_scores)"
```

---

## Task 6: promote.py — 승격 게이트 헬퍼

**Files:**
- Create: `4K_ML/serving/promote.py`
- Test: `4K_ML/tests/test_promote.py`

- [ ] **Step 1: 실패 테스트 작성**

`4K_ML/tests/test_promote.py`:

```python
from serving.promote import decide


def test_promote_when_better_or_equal():
    cur = {"spearman_movie_arousal": 0.75, "mae_arousal": 0.088}
    cand = {"spearman_movie_arousal": 0.78, "mae_arousal": 0.085}
    ok, _ = decide(cur, cand)
    assert ok is True


def test_hold_when_spearman_worse():
    cur = {"spearman_movie_arousal": 0.75, "mae_arousal": 0.088}
    cand = {"spearman_movie_arousal": 0.70, "mae_arousal": 0.085}
    ok, _ = decide(cur, cand)
    assert ok is False


def test_hold_when_mae_worse_beyond_tol():
    cur = {"spearman_movie_arousal": 0.75, "mae_arousal": 0.088}
    cand = {"spearman_movie_arousal": 0.76, "mae_arousal": 0.120}  # +0.032 > tol 0.02
    ok, _ = decide(cur, cand)
    assert ok is False


def test_hold_on_missing_metrics():
    ok, _ = decide({"spearman_movie_arousal": None, "mae_arousal": None},
                   {"spearman_movie_arousal": 0.8, "mae_arousal": 0.08})
    assert ok is False
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_promote.py -q`
Expected: FAIL (ModuleNotFoundError: serving.promote)

- [ ] **Step 3: 구현**

`4K_ML/serving/promote.py`:

```python
"""승격 게이트 — 두 model_version 지표 비교(서빙 변경은 사람이 GitOps로)."""


def decide(current: dict, candidate: dict, mae_tol: float = 0.02) -> tuple[bool, str]:
    """candidate가 current 대비 영화내 Spearman ≥ AND MAE ≤ +tol 이면 승격."""
    cs = current.get("spearman_movie_arousal")
    ks = candidate.get("spearman_movie_arousal")
    cm = current.get("mae_arousal")
    km = candidate.get("mae_arousal")
    if None in (cs, ks, cm, km):
        return False, "HOLD: metrics 누락"
    if ks >= cs and km <= cm + mae_tol:
        return True, f"PROMOTE: spearman {ks:.4f}>={cs:.4f}, mae {km:.4f}<={cm + mae_tol:.4f}"
    return False, f"HOLD: spearman {ks:.4f} vs {cs:.4f}, mae {km:.4f} vs <= {cm + mae_tol:.4f}"


if __name__ == "__main__":
    import os
    import sys

    import httpx

    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m serving.promote <current_mv> <candidate_mv>")
    url = os.getenv("AI_DATABASE_URL", "")
    key = os.getenv("AI_DATABASE_KEY", "")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def metrics(mv):
        r = httpx.get(f"{url}/rest/v1/model_versions",
                      params={"select": "metrics", "model_version": f"eq.{mv}", "limit": "1"},
                      headers=headers, timeout=30, verify=False)
        r.raise_for_status()
        rows = r.json()
        return rows[0]["metrics"] if rows else {}

    ok, msg = decide(metrics(sys.argv[1]), metrics(sys.argv[2]))
    print(msg)
    sys.exit(0 if ok else 1)
```

- [ ] **Step 4: 통과 확인 + 전체 회귀**

Run: `python -m pytest tests/test_predict_core.py tests/test_serving_db.py tests/test_score_main.py tests/test_promote.py -q`
Expected: 전체 PASS

- [ ] **Step 5: Commit**

```bash
git add 4K_ML/serving/promote.py 4K_ML/tests/test_promote.py
git commit -m "feat(serving): 승격 게이트 헬퍼 decide() + CLI"
```

---

## Task 7: 배포 매니페스트 — Dockerfile · InferenceService · WT · CI

**Files:**
- Modify: `4K_ML/Dockerfile`
- Create: `Ansible/manifests/4k-ml/inferenceservice-roberta-va.yaml`
- Create: `Ansible/manifests/4k-ml/workflowtemplate-score-scenes.yaml`
- Modify: `.github/workflows/deploy-4k-ml.yml`

- [ ] **Step 1: Dockerfile에 serving COPY 추가**

`4K_ML/Dockerfile`에서 `COPY train/ ./train/` 다음 줄에 추가:
```dockerfile
COPY serving/ ./serving/
```

- [ ] **Step 2: InferenceService (RawDeployment, CPU, PVC 직접 마운트)**

`Ansible/manifests/4k-ml/inferenceservice-roberta-va.yaml`:
```yaml
# roberta-va 서빙 — KServe RawDeployment, CPU, ml-models PVC를 /mnt/models로 직접 마운트.
# (custom 컨테이너라 storageUri 대신 PVC 볼륨 직접 마운트가 단순/확실.)
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: roberta-va
  namespace: ai
  annotations:
    serving.kserve.io/deploymentMode: RawDeployment
spec:
  predictor:
    nodeSelector:
      workload: gpu          # ml-models PVC가 vm5(local-path)라 vm5 고정. GPU는 요청 안 함.
    containers:
      - name: kserve-container
        image: ghcr.io/sanggyoon/4k-ml:latest
        command: ["python", "-m", "serving.serve"]
        env:
          - name: MODEL_DIR
            value: /mnt/models
        envFrom:
          - secretRef:
              name: 4k-ml-secrets
        volumeMounts:
          - name: models
            mountPath: /mnt/models
            subPath: roberta-va-v1
        resources:
          requests:
            cpu: "1"
            memory: 2Gi
          limits:
            cpu: "2"
            memory: 4Gi
    volumes:
      - name: models
        persistentVolumeClaim:
          claimName: ml-models
```

- [ ] **Step 3: 스코어링 WorkflowTemplate (CPU)**

`Ansible/manifests/4k-ml/workflowtemplate-score-scenes.yaml`:
```yaml
# 배치 스코어링(F) — KServe predict 호출 → scene_scores 적재. GPU 불필요.
# 제출: argo submit --from workflowtemplate/score-scenes -n ai
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: score-scenes
  namespace: ai
spec:
  serviceAccountName: argo-workflow
  entrypoint: main
  templates:
    - name: main
      container:
        image: ghcr.io/sanggyoon/4k-ml:latest
        command: ["python", "-m", "serving.score_scenes"]
        env:
          - name: KSERVE_PREDICT_URL
            value: http://roberta-va-predictor.ai.svc.cluster.local/v1/models/roberta-va:predict
        envFrom:
          - secretRef:
              name: 4k-ml-secrets
```

- [ ] **Step 4: CI 태그 bump에 score-scenes + InferenceService 추가**

`.github/workflows/deploy-4k-ml.yml`의 `Update image tag in WorkflowTemplate` 스텝 `run:` 끝에 추가:
```yaml
          sed -i 's|image: ghcr.io/sanggyoon/4k-ml:.*|image: ghcr.io/sanggyoon/4k-ml:${{ steps.vars.outputs.sha }}|' \
            Ansible/manifests/4k-ml/workflowtemplate-score-scenes.yaml
          sed -i 's|image: ghcr.io/sanggyoon/4k-ml:.*|image: ghcr.io/sanggyoon/4k-ml:${{ steps.vars.outputs.sha }}|' \
            Ansible/manifests/4k-ml/inferenceservice-roberta-va.yaml
```
그리고 `Commit and push manifest update`의 `git add` 줄에 두 파일 추가:
```yaml
          git add Ansible/manifests/4k-ml/workflowtemplate-subtitle-parse.yaml Ansible/manifests/4k-ml/workflowtemplate-llm-labeling.yaml Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml Ansible/manifests/4k-ml/workflowtemplate-score-scenes.yaml Ansible/manifests/4k-ml/inferenceservice-roberta-va.yaml
```

- [ ] **Step 5: YAML 검증**

Run (저장소 루트):
```bash
python -c "import yaml; yaml.safe_load(open('Ansible/manifests/4k-ml/inferenceservice-roberta-va.yaml')); yaml.safe_load(open('Ansible/manifests/4k-ml/workflowtemplate-score-scenes.yaml')); list(yaml.safe_load_all(open('.github/workflows/deploy-4k-ml.yml'))); print('yaml ok')"
```
Expected: `yaml ok`

- [ ] **Step 6: Commit**

```bash
git add 4K_ML/Dockerfile Ansible/manifests/4k-ml/inferenceservice-roberta-va.yaml Ansible/manifests/4k-ml/workflowtemplate-score-scenes.yaml .github/workflows/deploy-4k-ml.yml
git commit -m "build(serving): Docker serving COPY + InferenceService + score-scenes WT + CI"
```

---

## Task 8: KServe 설치 (클러스터 인프라 — 사용자 실행)

> 코드 외 1회성 부트스트랩. TDD 아님. 사용자가 클러스터에서 실행.

- [ ] **Step 1: KServe 컨트롤러 설치 (RawDeployment용, cert-manager 기존 사용)**

```bash
kubectl apply --server-side -f https://github.com/kserve/kserve/releases/download/v0.13.1/kserve.yaml
kubectl apply --server-side -f https://github.com/kserve/kserve/releases/download/v0.13.1/kserve-cluster-resources.yaml
```
컨트롤러 Ready 확인: `kubectl get pods -n kserve`

- [ ] **Step 2: 기본 deploymentMode를 RawDeployment로**

```bash
kubectl patch configmap inferenceservice-config -n kserve --type merge \
  -p '{"data":{"deploy":"{\"defaultDeploymentMode\":\"RawDeployment\"}"}}'
```
(InferenceService에 어노테이션 `serving.kserve.io/deploymentMode: RawDeployment`도 명시돼 있어 이 패치는 보조.)

- [ ] **Step 3: 동작 확인 (코드/매니페스트 배포 후)**

main 병합·push → CI 빌드 → ArgoCD 동기화 후:
```bash
kubectl get inferenceservice -n ai
kubectl get pods -n ai | grep roberta-va
```
Predictor 파드 Ready, InferenceService READY=True 확인. 엔드포인트 스모크:
```bash
kubectl run curl-test -n ai --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://roberta-va-predictor.ai.svc.cluster.local/v1/models/roberta-va:predict \
  -d '{"instances":[{"text":"he runs","progress_ratio":0.9,"start_ms":0,"end_ms":2000,"dialogue_count":3,"avg_gap_before_ms":100}]}'
```
→ `{"predictions":[{"arousal":..,"valence":..}],"model_version":"roberta-va-v1"}` 형태면 정상.

---

## 배포 후 수동 작업 (코드 외 — 사용자)

1. main 병합 + push → CI 이미지 빌드(serving 포함) → WT/InferenceService 태그 bump → ArgoCD 동기화.
2. Task 8의 KServe 설치(1회) + deploymentMode 패치.
3. InferenceService Ready 확인(위 스모크).
4. 스코어링 실행: Argo `score-scenes` 제출 → `scene_scores`에 `roberta-va-v1::arousal/valence` 적재 확인:
   ```sql
   select model_version, count(*) from scene_scores where model_version like 'roberta-va-v1%' group by model_version;
   ```
5. → 다음 G(임베딩)에서 `roberta-va-v1::arousal`을 읽어 movie_vectors 생성.

---

## Self-Review 결과

**Spec coverage:** §2 결정 — KServe RawDeployment/CPU → Task7·8; predictor 원본필드+내부변환 → Task2·3; student 균일 출처 → Task5; Argo 배치/score_state 멱등 → Task5; predictor가 model_version 반환·잡이 태깅 → Task3(predict 반환)·5(zip 태깅); 승격 게이트 헬퍼 → Task6. §4 컴포넌트 전부 매핑. §5 데이터모델(ensure_model_versions FK) → Task4. §6 리스크(PVC 노드/clamp) → Task7(nodeSelector)·2/5(clamp). §7 테스트 → 각 Task.

**Placeholder scan:** 코드/명령 구체화. kserve 미설치라 predictor/serve는 단위테스트 없이 py_compile + 런타임 스모크(Task8)로 검증 — 의도적(테스트는 코어가 담당). KServe 설치는 사용자 클러스터 작업으로 명시.

**Type consistency:** predict_core.score_instances 입력 키(text/progress_ratio/start_ms/end_ms/dialogue_count/avg_gap_before_ms)가 compute_features(FEATURE_ORDER)와 일치, db.fetch_movie_scenes_for_scoring 출력·score_scenes instances 구성과 동일. predictor 응답 `{"predictions","model_version"}`를 score_scenes가 동일 키로 소비. `model_version` → `::arousal/::valence` 태깅이 db.ensure_model_versions가 만드는 행과 일치. promote.decide 키(spearman_movie_arousal/mae_arousal)는 E의 metrics 키와 일치.
```