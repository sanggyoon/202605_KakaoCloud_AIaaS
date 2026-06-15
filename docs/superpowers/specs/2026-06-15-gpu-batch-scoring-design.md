# GPU 배치 스코어링 (수동) 설계 — 스코어링 실행 2-트랙

**작성일:** 2026-06-15
**범위:** 대량 스코어링을 빠르게 처리하는 **GPU 인프로세스 배치 잡(수동)** 추가. 기존 CPU KServe 온라인 스코어링(6시간 크론)은 그대로 유지.
**관련:** [[project_4k_ml_pipeline]]. 동기: CPU KServe 추론이 느림(영화당 수십초). GPU면 10~30배 빠름.

---

## 1. 목표

스코어링 실행을 **2-트랙**으로 분리:
- **트랙 A (현행)**: CPU KServe 온라인 + 6시간 크론. 평소 소량 증분. 변경 없음.
- **트랙 B (신규)**: GPU 인프로세스 배치 잡, **수동 제출**. 대량 백필을 빠르게.

두 트랙은 같은 모델·같은 타깃 로직·같은 `scene_scores` 결과를 공유. `(scenes_id, model_version)` 유니크 upsert라 멱등하게 공존(동시 처리해도 안전).

---

## 2. 핵심 결정 (브레인스토밍 확정)

| # | 결정 |
|---|---|
| 1 | CPU KServe 온라인 + 크론 = **현행 유지**(변경 없음) |
| 2 | GPU 배치 = **신규, 수동 제출 전용**(CronWorkflow 아님) |
| 3 | GPU 배치는 KServe HTTP 미사용 — **predict_core로 모델 인프로세스 로드**(GPU) |
| 4 | 타깃 = `fetch_score_targets`(활성버전 결산) **전부 한 번에** 처리(개수 제한 옵션 없음) |
| 5 | `predict_core`에 device 지원 추가(cuda 가용 시 GPU, 없으면 CPU 폴백) → 트랙 A도 그대로 동작 |
| 6 | 동시실행 락 없음(멱등이라 불필요). GPU 경합은 사람이 학습과 안 겹치게 제출로 회피 |

---

## 3. 컴포넌트 / 데이터 흐름

```
[트랙 A] score-scenes (CPU, 6h 크론)
  fetch_score_targets → 영화별 씬 → KServe HTTP predict → scene_scores 적재   (현행)

[트랙 B] score-scenes-gpu (GPU, 수동)
  fetch_active_version → PVC /models/{active}/ 모델 로드(predict_core, cuda)
  fetch_score_targets → 영화별 씬(fetch_movie_scenes_for_scoring)
    → predict_core.score_instances(GPU, 인프로세스)
    → ensure_model_versions + upsert_scene_scores({active}::arousal/valence) + set_score_state(done)
```

- 활성버전 = vm5 `model_versions.active`(P1). GPU 배치는 이 버전의 PVC 모델을 로드하고 그 버전으로 태깅.
- 적재/상태 헬퍼는 `serving/db.py` 기존 함수 재사용.

---

## 4. 변경/신규 파일

| 파일 | 변경 |
|---|---|
| `4K_ML/serving/predict_core.py` | `load_artifacts`/`score_instances`에 **device 인자**(기본 auto: cuda 가용 시 cuda, else cpu). model·입력텐서 `.to(device)`. CPU 동작 불변 |
| `4K_ML/serving/score_scenes_gpu.py` | **신규** — GPU 인프로세스 배치 `run()`. predict_core 로드 + 타깃 결산 + 적재 |
| `Ansible/manifests/4k-ml/workflowtemplate-score-scenes-gpu.yaml` | **신규** — GPU 1개 요청 + nodeSelector(gpu) + PVC `ml-models` 마운트, `python -m serving.score_scenes_gpu`. CronWorkflow 아님 |
| `.github/workflows/deploy-4k-ml.yml` | 새 WT를 이미지 태그 bump 목록 + git add에 추가 |

> CPU 경로(`score_scenes.py`)·KServe InferenceService·크론은 **건드리지 않음.**

---

## 5. 세부

### 5.1 `predict_core` device
- `load_artifacts(model_dir, encoder_name="roberta-base", device=None)`: `device = device or ("cuda" if torch.cuda.is_available() else "cpu")`; 로드 후 `model.to(device).eval()`; device를 반환에 포함(또는 score_instances에 전달).
- `score_instances(..., device="cpu")`: numeric/토큰 텐서를 `.to(device)`, 추론 후 결과 CPU로. fp32 추론(학습은 fp16였지만 추론은 fp32로 단순·안전).

### 5.2 `score_scenes_gpu.run()`
- env: `AI_DATABASE_URL/KEY`, `MODEL_BASE_DIR`(기본 `/models`). KServe URL 불필요.
- `mv = db.fetch_active_version(client)`; `model_dir = f"{MODEL_BASE_DIR}/{mv}"`.
- `model, scaler, tokenizer, max_len = predict_core.load_artifacts(model_dir)`; device 자동.
- `targets = db.fetch_score_targets(client)` (전부).
- 영화별: `scenes = fetch_movie_scenes_for_scoring`; 비면 `set_score_state(done)` 후 skip; 아니면 `instances` 구성 → `predict_core.score_instances(...)` → rows(`{mv}::arousal/valence`, clamp01) → `ensure_model_versions(mv)`(1회) + `upsert_scene_scores` + `set_score_state(done)`.
- 진행 로그(처리/실패 카운트). 실패는 건너뛰고 계속(멱등 재실행 가능).

### 5.3 WorkflowTemplate `score-scenes-gpu`
- `score-scenes` WT를 베이스로: 동일 이미지, `command: ["python","-m","serving.score_scenes_gpu"]`, `envFrom: 4k-ml-secrets`.
- 추가: `resources.limits["nvidia.com/gpu"]: 1`, `nodeSelector: { workload: gpu }`(train-roberta WT 동일), PVC `ml-models`(claimName) 마운트 `mountPath: /models`(train WT 동일, subPath 없음 → 전체 PVC). KServe InferenceService와 동일 PVC.
- **수동 실행**: `argo submit --from workflowtemplate/score-scenes-gpu -n ai`.

---

## 6. 테스트

- `predict_core`: device 인자로 CPU 경로 회귀(기존 test_predict_core 통과 유지) + device="cpu" 명시 동작.
- `score_scenes_gpu`: `run()`의 순수 분리 가능한 부분(인스턴스 구성/행 매핑)을 단위 테스트. 모델 로드·GPU는 모킹(predict_core monkeypatch)으로 흐름 검증(타깃→적재 호출).
- 라이브: vm5에서 `argo submit --from workflowtemplate/score-scenes-gpu -n ai` 1회 → 스테일/미점수 영화가 CPU보다 빠르게 채워지는지, scene_scores 증가 확인.

---

## 7. 리스크 / 엣지

- **GPU 경합**: 트랙 B와 학습이 동시 GPU 요청 시 한쪽 Pending. 둘 다 수동이라 사람이 시차 제출로 회피(문서화). 자동 락은 YAGNI.
- **CUDA torch**: 4k-ml 이미지가 학습용 CUDA torch 포함 → GPU 동작 가능. 미가용 노드면 device 폴백으로 CPU(느리지만 동작).
- **PVC 모델 경로**: 활성버전 폴더(`/models/{active}/`)가 PVC에 있어야 함(학습이 거기에 저장). 없으면 잡 실패(명확한 에러).
- **멱등**: 동일 (scene, model_version) upsert merge → 트랙 A/B 동시·중복 안전.

## 8. 범위 밖

- 트랙 자동 선택/전환, 동시실행 락, GPU 오토스케일, P2(자동 학습·승격). KServe InferenceService·CPU 크론 변경.
