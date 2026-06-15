# GPU 배치 스코어링 (수동) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대량 스코어링을 빠르게 처리하는 GPU 인프로세스 배치 잡(수동 제출)을 추가한다. 기존 CPU KServe 온라인 스코어링·6시간 크론은 그대로 둔다.

**Architecture:** `predict_core`에 device 지원을 더해(cuda 자동) 모델을 인프로세스 로드. 신규 `serving/score_scenes_gpu.py`가 활성버전 모델을 GPU로 로드해 `fetch_score_targets` 전부를 추론·적재(KServe HTTP 없음). 신규 WorkflowTemplate `score-scenes-gpu`(GPU, 수동).

**Tech Stack:** Python(torch CUDA, transformers, httpx), Argo WorkflowTemplate(GPU), pytest. 기존 `serving/db.py`·`predict_core.py` 재사용.

**선행 스펙:** `docs/superpowers/specs/2026-06-15-gpu-batch-scoring-design.md`

**경로:** ML=`4K_ML`, manifests=`Ansible/manifests/4k-ml`, CI=`.github/workflows/deploy-4k-ml.yml`. git 루트=`/Users/sanggyoon/Documents/KakaoCloud_Project`. 커밋 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**테스트:** `cd 4K_ML && python -m pytest <file> -v`.

---

## 사전 메모

- `predict_core.load_artifacts(model_dir, encoder_name="roberta-base")` → `(model, scaler, tok, cfg)`. `score_instances(model, scaler, tokenizer, max_len, instances)` → `[{arousal, valence}]`. `predictor.py`(CPU 트랙 A)가 이 둘을 사용 → **시그니처/반환 arity 유지 필수**(device는 선택 인자로).
- `serving/db.py` 재사용: `fetch_active_version`, `fetch_score_targets`, `fetch_movie_scenes_for_scoring`, `ensure_model_versions`, `upsert_scene_scores`, `set_score_state`.
- train WT 패턴(GPU): `podSpecPatch: runtimeClassName: nvidia`, `volumes: ml-models`, `nodeSelector: {workload: gpu}`, `volumeMounts: /models`, `resources.limits.nvidia.com/gpu: 1`. 모델은 PVC `/models/{version}/`.

---

## Task 1: `predict_core` device 지원 (CPU 트랙 불변)

**Files:** Modify `4K_ML/serving/predict_core.py` · Test `4K_ML/tests/test_predict_core.py`(회귀)

- [ ] **Step 1: 회귀 베이스 확인 (기존 테스트 통과 상태)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_predict_core.py -q`
Expected: 통과(현행).

- [ ] **Step 2: device 추가 구현**

`4K_ML/serving/predict_core.py`의 `load_artifacts`와 `score_instances`를 다음으로 교체:
```python
def load_artifacts(model_dir: str, encoder_name: str = "roberta-base", device=None):
    """산출물 디렉터리에서 모델/스케일러/토크나이저/설정 로드. device 미지정 시 cuda 가용하면 cuda."""
    from safetensors.torch import load_file
    from transformers import RobertaTokenizerFast

    cfg = json.load(open(os.path.join(model_dir, "config.json")))
    scaler = Scaler.load(os.path.join(model_dir, "scaler.json"))
    tok = RobertaTokenizerFast.from_pretrained(model_dir)
    model = HybridRobertaRegressor(build_encoder(encoder_name))
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
```

- [ ] **Step 3: 회귀 통과 확인 (CPU 트랙 불변)**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_predict_core.py -q`
Expected: 통과(모델이 cpu, 텐서도 cpu로 이동 → 동일 결과).

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/serving/predict_core.py
git commit -m "feat(gpu-score): predict_core device 지원(cuda 자동, CPU 트랙 불변)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `score_scenes_gpu.py` — GPU 인프로세스 배치

**Files:** Create `4K_ML/serving/score_scenes_gpu.py` · Test `4K_ML/tests/test_score_gpu.py`

- [ ] **Step 1: 실패 테스트 작성 (순수 매핑 + 흐름 모킹)**

`4K_ML/tests/test_score_gpu.py`:
```python
from serving import score_scenes_gpu as g


def test_scene_score_rows_maps_axes_and_clamps():
    scenes = [{"scenes_id": 10}, {"scenes_id": 11}]
    preds = [{"arousal": 0.4, "valence": 1.2}, {"arousal": -0.1, "valence": 0.7}]
    rows = g.scene_score_rows(scenes, preds, "roberta-va-v1")
    assert rows == [
        {"scenes_id": 10, "score": 0.4, "model_version": "roberta-va-v1::arousal"},
        {"scenes_id": 10, "score": 1.0, "model_version": "roberta-va-v1::valence"},  # clamp 1.2→1.0
        {"scenes_id": 11, "score": 0.0, "model_version": "roberta-va-v1::arousal"},  # clamp -0.1→0.0
        {"scenes_id": 11, "score": 0.7, "model_version": "roberta-va-v1::valence"},
    ]


def test_run_flow_loads_active_model_and_upserts(monkeypatch):
    monkeypatch.setenv("AI_DATABASE_URL", "http://vm5")
    monkeypatch.setenv("AI_DATABASE_KEY", "k")
    calls = {"upsert": [], "states": []}

    monkeypatch.setattr(g.predict_core, "load_artifacts",
                        lambda model_dir, **kw: ("M", "S", "T", {"max_len": 8}))
    monkeypatch.setattr(g.predict_core, "score_instances",
                        lambda m, s, t, ml, inst: [{"arousal": 0.5, "valence": 0.5} for _ in inst])
    monkeypatch.setattr(g.db, "fetch_active_version", lambda c: "roberta-va-v1")
    monkeypatch.setattr(g.db, "ensure_model_versions", lambda c, mv: None)
    monkeypatch.setattr(g.db, "fetch_score_targets", lambda c: [1])
    monkeypatch.setattr(g.db, "fetch_movie_scenes_for_scoring",
                        lambda c, tid: [{"scenes_id": 10, "text": "a", "progress_ratio": 0.1,
                                         "start_ms": 0, "end_ms": 1, "dialogue_count": 1,
                                         "avg_gap_before_ms": 0.0}])
    monkeypatch.setattr(g.db, "upsert_scene_scores", lambda c, rows: calls["upsert"].extend(rows))
    monkeypatch.setattr(g.db, "set_score_state", lambda c, tid, st: calls["states"].append((tid, st)))

    class FakeClient:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(g.httpx, "Client", lambda *a, **k: FakeClient())

    g.run()
    assert {r["model_version"] for r in calls["upsert"]} == {
        "roberta-va-v1::arousal", "roberta-va-v1::valence"}
    assert calls["states"] == [(1, "done")]
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_score_gpu.py -q`
Expected: FAIL (`serving.score_scenes_gpu` 없음)

- [ ] **Step 3: 구현**

`4K_ML/serving/score_scenes_gpu.py`:
```python
#!/usr/bin/env python3
"""GPU 인프로세스 배치 스코어링(수동) — 활성모델 직접 로드, KServe 미사용.

env: AI_DATABASE_URL, AI_DATABASE_KEY (선택 AI_BASIC_*), MODEL_BASE_DIR(기본 /models)
실행(수동): argo submit --from workflowtemplate/score-scenes-gpu -n ai
"""
import os

import httpx

from serving import db, predict_core


def _clamp01(x) -> float:
    return float(min(1.0, max(0.0, float(x))))


def scene_score_rows(scenes: list[dict], preds: list[dict], mv: str) -> list[dict]:
    """씬 + 예측 → scene_scores upsert 행(축별). (순수)"""
    rows: list[dict] = []
    for s, p in zip(scenes, preds):
        rows.append({"scenes_id": s["scenes_id"], "score": _clamp01(p["arousal"]),
                     "model_version": f"{mv}::arousal"})
        rows.append({"scenes_id": s["scenes_id"], "score": _clamp01(p["valence"]),
                     "model_version": f"{mv}::valence"})
    return rows


def run() -> None:
    if not os.getenv("AI_DATABASE_URL") or not os.getenv("AI_DATABASE_KEY"):
        raise SystemExit("AI_DATABASE_URL, AI_DATABASE_KEY 필요 (vm5).")
    base = os.getenv("MODEL_BASE_DIR", "/models")
    counts = {"done": 0, "failed": 0}
    with httpx.Client(timeout=60, verify=False) as client:
        mv = db.fetch_active_version(client)
        model_dir = f"{base}/{mv}"
        print(f"=== GPU 배치 스코어링: 활성모델 {mv} ({model_dir}) ===")
        model, scaler, tok, cfg = predict_core.load_artifacts(model_dir)
        max_len = int(cfg.get("max_len", 512))
        db.ensure_model_versions(client, mv)
        targets = db.fetch_score_targets(client)
        print(f"  대상 {len(targets):,}편")
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
                preds = predict_core.score_instances(model, scaler, tok, max_len, instances)
                db.upsert_scene_scores(client, scene_score_rows(scenes, preds, mv))
                db.set_score_state(client, tmdb_id, "done")
                counts["done"] += 1
            except Exception as e:  # 한 편 실패해도 계속(멱등 재실행 가능)
                counts["failed"] += 1
                print(f"  [실패] tmdb={tmdb_id}: {e}")
    print(f"✅ done={counts['done']} failed={counts['failed']}")


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/test_score_gpu.py -q`
Expected: 2 passed

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add 4K_ML/serving/score_scenes_gpu.py 4K_ML/tests/test_score_gpu.py
git commit -m "feat(gpu-score): GPU 인프로세스 배치 스코어링 잡(수동)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: WorkflowTemplate `score-scenes-gpu` + CI 등록

**Files:** Create `Ansible/manifests/4k-ml/workflowtemplate-score-scenes-gpu.yaml` · Modify `.github/workflows/deploy-4k-ml.yml`

- [ ] **Step 1: WorkflowTemplate 작성 (train-roberta GPU 패턴)**

`Ansible/manifests/4k-ml/workflowtemplate-score-scenes-gpu.yaml`:
```yaml
# GPU 인프로세스 배치 스코어링(수동). 대량 백필용. 활성모델을 PVC에서 로드해 GPU 추론.
# 제출: argo submit --from workflowtemplate/score-scenes-gpu -n ai
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: score-scenes-gpu
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
        image: ghcr.io/sanggyoon/4k-ml:0de3796
        command: ["python", "-m", "serving.score_scenes_gpu"]
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

- [ ] **Step 2: CI 이미지 태그 bump 등록**

`.github/workflows/deploy-4k-ml.yml`의 sed bump 블록에 한 줄 추가(`workflowtemplate-generate-vectors.yaml` sed 다음):
```yaml
          sed -i 's|image: ghcr.io/sanggyoon/4k-ml:.*|image: ghcr.io/sanggyoon/4k-ml:${{ steps.vars.outputs.sha }}|' \
            Ansible/manifests/4k-ml/workflowtemplate-score-scenes-gpu.yaml
```
그리고 `git add` 라인 끝에 ` Ansible/manifests/4k-ml/workflowtemplate-score-scenes-gpu.yaml` 추가.

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/manifests/4k-ml/workflowtemplate-score-scenes-gpu.yaml .github/workflows/deploy-4k-ml.yml
git commit -m "feat(gpu-score): score-scenes-gpu WorkflowTemplate(GPU) + CI 태그 bump

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 마무리 + 사용 안내

**Files:** (없음)

- [ ] **Step 1: 전체 ML 테스트**

Run: `cd /Users/sanggyoon/Documents/KakaoCloud_Project/4K_ML && python -m pytest tests/ -q`
Expected: 전부 통과.

- [ ] **Step 2: 사용 안내 (배포 후)**

- main 병합·push → CI 빌드 + WT 태그 bump → ArgoCD가 `score-scenes-gpu` WT 동기화.
- 대량 백필 시 **수동 제출**: `argo submit --from workflowtemplate/score-scenes-gpu -n ai`.
- **주의**: 학습 잡(GPU)과 동시 제출하면 GPU 경합(한쪽 Pending) — 시차 두고 제출.
- 평소 소량은 트랙 A(CPU 크론)가 자동 처리(변경 없음).

- [ ] **Step 3: finishing-a-development-branch**

**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

---

## Self-Review 메모

- **스펙 커버리지:** device 지원=T1; GPU 배치 잡(predict_core 인프로세스·전체 타깃·적재)=T2; WT(GPU·PVC·수동)+CI=T3. CPU 트랙/KServe/크론 불변(건드리는 태스크 없음).
- **타입 일관성:** `load_artifacts(..., device=None)`→4-tuple(arity 유지, predictor.py 호환), `score_instances` 시그니처 불변, `scene_score_rows(scenes, preds, mv)`, `run()`. db 헬퍼명(`fetch_active_version`/`fetch_score_targets`/`fetch_movie_scenes_for_scoring`/`ensure_model_versions`/`upsert_scene_scores`/`set_score_state`) 기존과 일치.
- **placeholder:** 코드 스텝 완전. T2 흐름 테스트는 db·predict_core monkeypatch로 GPU 없이 검증.
- **엣지:** GPU 미가용 노드면 predict_core가 cpu 폴백(느리지만 동작); 모델 폴더 없으면 load_artifacts에서 명확한 파일 에러; 한 편 실패해도 계속.
