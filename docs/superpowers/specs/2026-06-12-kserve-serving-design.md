# 서브프로젝트 F — KServe 서빙 + 배치 스코어링 설계

**작성일:** 2026-06-12
**파이프라인 위치:** 7단계 중 6단계 (… 학습[E 완료] → **KServe 서빙 + 스코어링[F]** → 임베딩[G])

---

## 1. 목표

학습된 `roberta-va-v1` 모델을 **KServe InferenceService(RawDeployment)**로 서빙하고, **Argo 배치 스코어링 잡**이 이 엔드포인트를 호출해 파싱된 모든 영화의 씬을 점수화하여 `scene_scores`에 `roberta-va-v1::arousal/valence`로 적재한다. G(그래프)는 이 student 점수를 균일 출처로 읽는다. 재학습 시 경량 승격 게이트로 버전 교체를 판단한다.

---

## 2. 핵심 결정 (브레인스토밍 확정)

| 주제 | 결정 |
|---|---|
| 서빙 | **KServe**(AIaaS 시연), **RawDeployment 모드**(Knative 없음, cert-manager·nginx 기존 활용) |
| 추론 디바이스 | **CPU predictor** (단일 T4는 학습/배치용으로 비워둠, 콜드스타트 없음) |
| predictor 계약 | **원본 씬 필드 입력 → 내부에서 compute_features + scaler + 토크나이즈 + 추론** (train/serve 스큐 차단) |
| 출처(scope) | **student 균일** — 파싱된 모든 영화를 roberta-va-v1로 점수화, G는 student만 읽음. teacher(llm-va-v1)는 학습데이터 전용 |
| 구동 | **Argo 배치 잡**, `parse_state=done & score_state!=done` 멱등 |
| 적재 버전 태깅 | predictor가 응답에 **자기 model_version**(config.json)을 실어줌 → 잡이 그 값으로 `scene_scores` 태깅(서빙↔적재 불일치 방지) |
| 승격 게이트 | **경량 헬퍼**(model_versions 지표 비교 → 승격/보류) + **수동 GitOps**로 storageUri 교체. 서빙 자동변경 안 함 |

---

## 3. 아키텍처

```
[Argo 배치 스코어링 잡 score-scenes]
  vm5: parse_state=done & score_state!=done 영화 선택
   └ 영화별 씬 조회(text + 원본 피처필드)
       └ POST http://roberta-va-predictor.ai.svc/v1/models/roberta-va:predict
           {"instances":[{text, progress_ratio, start_ms, end_ms, dialogue_count, avg_gap_before_ms}, ...]}
       ← {"predictions":[{arousal, valence}, ...], "model_version":"roberta-va-v1"}
   └ scene_scores upsert (roberta-va-v1::arousal/valence) + score_state=done

[KServe InferenceService roberta-va] (RawDeployment, CPU)
  predictor 컨테이너(4k-ml 이미지 + kserve):
    load(): /mnt/models(storageUri=pvc://ml-models/roberta-va-v1) →
            config.json·scaler.json·model.safetensors·tokenizer →
            HybridRobertaRegressor(build_encoder("roberta-base")) state 로드, eval, cpu
    predict(): 인스턴스 → compute_features → scaler.transform → tokenize → forward(sigmoid) → [{arousal,valence}]
```

KServe는 **추론 엔드포인트만** 담당하고 DB 적재는 배치 잡이 한다. 배치 잡은 클러스터 내부 Service DNS로 predictor를 호출(인그레스 불필요).

---

## 4. 컴포넌트

### 4.1 KServe 설치 (인프라, RawDeployment)

- 전제 충족: **cert-manager 설치됨**, nginx ingressclass 존재, Knative/Istio 불필요.
- KServe 컨트롤러 설치(릴리스 매니페스트 또는 ArgoCD app) + `inferenceservice-config` ConfigMap에서 **`deploymentMode: RawDeployment`** 기본값 설정.
- 배치 호출은 in-cluster Service라 외부 인그레스 미설정(필요 시 추후).
- ArgoCD app `argocd-app-kserve.yaml`(또는 수동 apply 후 GitOps 편입) — 정확한 설치 방식은 구현 계획에서 확정.

### 4.2 커스텀 predictor (`4K_ML/serving/`)

> **구현 노트(2026-06-12 변경):** kserve SDK는 `numpy<2`·`httpx<0.27`을 강제해 우리 ML 스택(numpy 2·scipy 1.17·transformers)과 빌드 충돌 → **kserve SDK 대신 FastAPI로 KServe V1 프로토콜을 직접 구현**. KServe RawDeployment 커스텀 컨테이너는 프로토콜을 8080에서 서빙하면 충분하므로 아키텍처는 동일.

- `predict_core.py`(kserve 비의존): `load_artifacts(model_dir)`, `score_instances(model, scaler, tok, max_len, instances)` — 원본 씬 필드 → `compute_features`+`Scaler.transform`+토크나이즈+forward → `[{arousal,valence}]`(0~1 clamp).
- `predictor.py` — `create_app(loader)` FastAPI 앱:
  - startup에서 `MODEL_DIR`(기본 `/mnt/models`) 로드(config/scaler/tokenizer/weights, `HybridRobertaRegressor`+state_dict, CPU).
  - `GET /v1/models/roberta-va` → `{"ready": bool}` (readiness 프로브).
  - `POST /v1/models/roberta-va:predict` → `{"predictions":[...], "model_version":...}`.
- `serve.py` — `uvicorn.run(app, host=0.0.0.0, port=8080)` 진입점(`python -m serving.serve`).
- 의존성: `fastapi`+`uvicorn` 추가(`kserve` 미사용). 이미지 = **기존 4k-ml**(train 패키지·roberta-base 베이킹 포함) + `COPY serving/`.
- 재사용: `train.features.compute_features`/`Scaler`, `train.model.HybridRobertaRegressor`/`build_encoder` → **학습과 동일 변환** 보장.

### 4.3 InferenceService 매니페스트

`Ansible/manifests/4k-ml/inferenceservice-roberta-va.yaml`:
- `predictor.containers[0]`: image=4k-ml, `command: [python, -m, serving.serve]`, CPU 리소스(예 1 CPU/2Gi, **GPU 없음**), envFrom 4k-ml-secrets.
- `storageUri: pvc://ml-models/roberta-va-v1` → KServe가 PVC 서브경로를 `/mnt/models`에 마운트.
- 어노테이션 `serving.kserve.io/deploymentMode: RawDeployment`.
- nodeSelector: workload=app(또는 vm5 외 노드 — local-path PVC 접근 위해 **PVC가 있는 vm5 노드**에 스케줄돼야 함 → nodeSelector workload=gpu로 vm5 고정, GPU는 요청 안 함). 구현 계획에서 PVC 노드 친화성 확인.

### 4.4 스코어링 배치 잡 (`4K_ML/serving/`)

- `db.py` — vm5 REST: `fetch_score_targets`(parse_state=done & score_state!=done), `fetch_movie_scenes_for_scoring`(scenes + dialogues avg_gap → 원본 피처필드, 라벨 join 없음), `ensure_model_versions`(roberta-va-v1::arousal/valence 행 보장, FK용), `upsert_scene_scores`, `set_score_state`.
- `score_scenes.py` — `run()`:
  1. env 확인(AI_DATABASE_URL, KSERVE_URL=predictor 엔드포인트).
  2. `ensure_model_versions`.
  3. 대상 영화별: 씬 조회 → predictor POST(instances) → predictions + model_version 수신 → `{model_version}::arousal/valence` 행 적재(0~1 그대로, 모델이 sigmoid라 clamp 불필요하나 방어적 clamp) → `set_score_state(done)`.
  4. 실패 시 score_state=failed.
- Argo WorkflowTemplate `workflowtemplate-score-scenes.yaml`(GPU 불필요, CPU). 멱등 재실행.

### 4.5 승격 게이트 헬퍼 (`4K_ML/serving/promote.py`)

- `decide(current: dict, candidate: dict, mae_tol=0.02) -> tuple[bool,str]`: candidate의 `spearman_movie_arousal ≥ current` **AND** `mae_arousal ≤ current+tol` → (True,"PROMOTE") 아니면 (False,"HOLD" + 사유).
- CLI: 두 model_version을 받아 `model_versions.metrics` 조회 후 결과 출력. **실제 교체는 사람이** InferenceService `storageUri`를 새 버전으로 GitOps 커밋 + 새 버전으로 재스코어링(새 `roberta-va-vN::*` 적재, G는 새 버전 가리킴).

---

## 5. 데이터 모델 / 멱등성

- `scene_scores`(기존): student 점수를 `roberta-va-v1::arousal`/`::valence` 행으로 적재. teacher(`llm-va-v1::*`)와 공존, `(scenes_id, model_version)` unique.
- `model_versions`(기존): `roberta-va-v1`(모델·metrics, E에서 기록) + 신규 `roberta-va-v1::arousal`/`::valence`(점수 채널, kind=`roberta-score`) — scene_scores FK 충족.
- `processing_status.score_state`(기존 컬럼): pending→done/failed. 멱등(재실행 신규만).

## 6. 엣지/리스크

- **PVC 노드 친화**: local-path `ml-models`는 vm5에 바인딩(RWO). predictor·스코어링 잡 모두 vm5 스케줄 필요(nodeSelector). PVC는 동시 RWO 1마운트라, 학습(쓰기)과 서빙(읽기)이 겹치면 충돌 가능 → 학습 중엔 스코어링/서빙 재시작 회피, 또는 추후 RWX 스토리지로 승격(범위 밖).
- **roberta-base 미초기화 pooler 경고**: forward에서 CLS만 써서 무해(E와 동일).
- **CPU 추론 처리량**: 영화 1편(~50씬) 수 초. 전체 ~1,149편 1회 스코어링은 수십 분~시간대 — 배치라 허용. score_state 멱등이라 중단/재개 안전.
- **kserve 의존성 크기**: 이미지 비대화. 허용(서빙 표준).
- **버전 태깅 불일치 방지**: 적재 model_version은 항상 predictor 응답값 사용(매니페스트 storageUri와 자동 일치).

## 7. 테스트 (TDD)

- `test_predictor.py`: 소형 모델(RobertaConfig)+가짜 tokenizer로 `VAPredictor.predict`가 인스턴스→`{arousal,valence}` 0~1 반환, 응답에 model_version 포함, compute_features/scaler 경로 동작.
- `test_serving_db.py`: `fetch_score_targets` 필터, `fetch_movie_scenes_for_scoring` 조립, `ensure_model_versions`·`upsert_scene_scores`·`set_score_state` payload(MockTransport).
- `test_score_main.py`: 모킹된 db + 가짜 predictor HTTP로 `run()`이 씬당 2행 적재(응답 model_version 태깅) + score_state 전이, 실패 캡처.
- `test_promote.py`: `decide` 경계(Spearman 동률·MAE 허용치 경계) 판정.

## 8. 배포

- 이미지: 기존 4k-ml에 `COPY serving/` + `kserve` 의존성. CI가 빌드·태그 bump(score-scenes WT + InferenceService 이미지).
- KServe 컨트롤러 설치(RawDeployment) — 인프라 부트스트랩(릴리스 apply + config 패치), GitOps 편입.
- ArgoCD: InferenceService + score-scenes WorkflowTemplate를 ns ai에 동기화.
- 실행: InferenceService Ready 확인 → Argo `score-scenes` 제출(또는 추후 cron).

## 9. 범위 밖 (다음/이후)

- G: scene_scores(`roberta-va-v1::arousal`) → 표시 정규화/리샘플 → movie_vectors 적재.
- Ops: 스코어링 CronWorkflow, 매니저 트리거, 외부 인그레스, RWX 스토리지, 승격 자동화.
- teacher cron(llm-labeling)은 학습데이터 축적용으로 계속 — F 변경 없음.
