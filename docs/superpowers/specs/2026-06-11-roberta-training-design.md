# 서브프로젝트 E — 하이브리드 RoBERTa 학습 (Valence + Arousal 회귀) 설계

**작성일:** 2026-06-11
**파이프라인 위치:** 7단계 중 5단계 (… 라벨링[D 완료] → **RoBERTa 학습[E]** → KServe 서빙[F] → 임베딩[G])

---

## 1. 목표

teacher(LLM) 라벨(`scene_scores`, llm-va-v1)을 정답으로, 씬을 보고 **arousal·valence를 예측하는 student 모델**을 학습한다. 입력은 **씬 텍스트 + 숫자 피처(하이브리드)**, 출력은 2개 연속값(0~1). 산출물(가중치+스케일러+설정)을 vm5 PVC에 저장해 F(KServe)가 로드한다.

데이터셋: ~1,149편 / **56,899씬** (씬당 arousal·valence 라벨). 영화 단위로 train/val/test 분할.

---

## 2. 핵심 결정 (브레인스토밍 확정)

| 주제 | 결정 |
|---|---|
| 인코더 | `roberta-base` (~125M), **풀 파인튜닝** |
| 융합 | **late concat** — RoBERTa 풀링 벡터 ⊕ 숫자피처 → MLP 헤드 → 2-출력(sigmoid 0~1) |
| 숫자 피처(5) | progress_ratio, scene_duration_s, dialogue_count, words_per_sec, avg_gap_before_ms |
| 정규화 | z-score 표준화, **스케일러(mean/std) 산출물에 저장** |
| 분할 | **영화 단위 80/10/10**, 고정 시드, **test 셋 동결**(버전 간 비교용) |
| 타깃 | long `scene_scores` → 씬당 `[arousal, valence]` pivot |
| 산출물 저장 | **vm5 PVC**(k3s local-path), KServe가 `pvc://`로 로드 |
| 학습 프레임워크 | 커스텀 PyTorch 루프(투명·테스트 용이), fp16(amp), val 조기종료 |
| 평가 | MAE(축별), **영화내 Spearman(arousal=주지표)**, 전체 Pearson |
| 재학습/승격 | 라벨 +25% 또는 수동 재학습 / 고정 test로 비교, Spearman≥·MAE≤+tol일 때만 승격, 지표는 `model_versions.metrics` |
| model_version | `roberta-va-v1` (kind=`roberta-regressor`) |
| 실행 | Argo WorkflowTemplate, vm5 **GPU**(runtimeClassName nvidia, nodeSelector gpu, nvidia.com/gpu:1) |

---

## 3. 데이터 흐름

```
vm5 REST (영화 단위 조회)
  scenes(id,scene_index,text,progress_ratio,start_ms,end_ms,dialogue_count)
  dialogues(scenes_id,word_count,gap_before_ms)     # avg_gap 집계용
  scene_scores(scenes_id, score, model_version)     # llm-va-v1::arousal/valence
        │  영화별로 씬 레코드 조립: {text, 숫자피처5, y=[arousal,valence], movie_id}
        ▼
  영화 단위 80/10/10 분할(고정 시드) → split manifest
        ▼
  train: 숫자피처 z-score fit(train만) → 토크나이즈 + 텐서 → 커스텀 루프(fp16, 조기종료)
        ▼
  test 평가(MAE/영화내 Spearman/Pearson) → 산출물 PVC 저장 + model_versions.metrics 기록
```

숫자 피처 산출(씬 단위):
- `progress_ratio`: scenes 그대로
- `scene_duration_s` = (end_ms − start_ms) / 1000
- `dialogue_count`: scenes 그대로
- `words_per_sec` = len(scene.text.split()) / max(scene_duration_s, 1)
- `avg_gap_before_ms` = 그 씬 dialogues의 gap_before_ms 평균(없으면 0)

라벨 결측 처리: 두 축(arousal·valence) 모두 있는 씬만 학습 대상(불완전 씬 제외).

---

## 4. 모듈 구조 (`4K_ML/train/`)

| 파일 | 책임 |
|---|---|
| `train/db.py` | vm5 REST: 라벨 완료 영화 목록, 영화별 scenes/dialogues/scene_scores 조회, model_versions upsert(metrics) |
| `train/features.py` | 씬 숫자피처 5개 추출(순수) + z-score 스케일러(fit/transform/save/load, mean·std를 json) |
| `train/dataset.py` | 영화 단위 분할(고정 시드), torch `Dataset`(토크나이즈·피처·타깃), 토큰 길이 512 truncation |
| `train/model.py` | `HybridRobertaRegressor(nn.Module)`: RobertaModel + [pooled ⊕ numeric] → MLP(Linear→ReLU→Dropout→Linear) → sigmoid 2-출력 |
| `train/evaluate.py` | MAE(축별), 영화내 Spearman(arousal), 전체 Pearson (scipy.stats) |
| `train/train_model.py` | `run()`: 데이터 로드→분할→스케일러 fit→학습 루프(fp16, val 조기종료)→test 평가→산출물 PVC 저장 + model_versions 기록 |
| `train/tests/` | features/dataset 분할/model forward/evaluate 단위 테스트(작은 합성 데이터) |

의존성 추가(`4K_ML/requirements.txt`): `transformers`(현재 sentence-transformers로 전이 포함 → 명시 핀), `safetensors`. torch는 Docker 베이스 포함. 상관계수는 기존 `scipy`로 충분(추가 불필요). 스케일러는 numpy로 직접 구현(sklearn 불필요).

### 4.1 모델 (`model.py`)

```
입력: input_ids, attention_mask, numeric(z-scored, dim=5)
RobertaModel → last_hidden_state[:,0] (CLS, <s> 토큰)  → text_vec(768)
h = concat(text_vec, numeric)            # 768+5
MLP: Linear(773→256)→ReLU→Dropout(0.1)→Linear(256→2)→Sigmoid
출력: [arousal, valence] ∈ (0,1)
손실: MSE(출력, 타깃)
```

### 4.2 학습 루프 (`train_model.py`)

- AdamW(lr 2e-5, weight_decay 0.01), 선형 워밍업, fp16(`torch.cuda.amp`)
- batch 16, max_epochs 10, **val MAE 기준 조기종료**(patience 2), 최적 val 가중치 보존
- 재현성: 시드 고정(split·torch·numpy)
- 산출물 디렉터리 `/<PVC>/roberta-va-v1/`: 모델 state(safetensors), `scaler.json`(mean/std), `feature_config.json`(피처 순서), `split.json`(분할 영화 id), `config.json`(하이퍼파라미터·model_version), 토크나이저
- 완료 후 `model_versions` upsert: `{model_version:"roberta-va-v1", kind:"roberta-regressor", metrics:{mae_arousal,mae_valence,spearman_movie_arousal,pearson_arousal,pearson_valence,n_test}}`

### 4.3 평가/재학습 (`evaluate.py` + 정책)

- **지표**: MAE 축별, 영화내 Spearman(arousal, test 영화별 계산 후 평균) = 주지표, Pearson 보조
- **고정 test 셋**: `split.json`의 test 영화는 재학습마다 동일 유지(새 데이터는 train/val에만)
- **재학습**: 라벨 +25%↑ 또는 수동
- **승격 게이트**(F에서 모델 교체 판단): 새 버전 test Spearman ≥ 기존 AND MAE ≤ 기존+tol(예 0.02). 미달 시 기존 유지. 비교 근거는 `model_versions.metrics` 이력.

---

## 5. 배포·실행

- `4K_ML/Dockerfile`: `COPY train/ ./train/` 추가. requirements에 transformers/safetensors 추가.
- **PVC 매니페스트**(신규): `Ansible/manifests/4k-ml/pvc-models.yaml` — ns ai, local-path, ReadWriteOnce, 예: 10Gi. (vm5 노드-로컬, train·serve 모두 vm5.)
- **WorkflowTemplate**(신규): `Ansible/manifests/4k-ml/workflowtemplate-train-roberta.yaml` — GPU(runtimeClassName nvidia, nodeSelector workload=gpu, nvidia.com/gpu:1), `command: python -m train.train_model`, envFrom 4k-ml-secrets, **PVC 마운트**(/models). roberta-base는 **이미지에 베이킹**(all-MiniLM 패턴 재사용, HF_TOKEN 빌드시크릿) — 런타임 HF 다운로드 회피.
- CI(`deploy-4k-ml.yml`)가 새 WorkflowTemplate 이미지 태그 bump 대상에 포함(sed 1줄 추가).
- 실행: Argo UI(ns ai, train-roberta) 또는 kubectl. 1회성, 데이터 +25% 시 재실행.
- `ANTHROPIC_API_KEY` 불필요(LLM 호출 없음). vm5 REST 키만 필요.

---

## 6. 엣지/리스크

- **긴 씬 텍스트** > 512 토큰 → truncation(꼬리 손실 감수). 평균 씬은 512 이내 추정, 초과분만 잘림.
- **HF 다운로드 429**(CI 공용 IP) → roberta-base를 이미지에 베이킹(파싱 단계 all-MiniLM 패턴 재사용, HF_TOKEN 빌드시크릿).
- **PVC 동시 접근**: local-path RWO, train→serve 순차 사용이라 충돌 없음(동시 쓰기 안 함).
- **라벨 노이즈**(teacher 한계) → 회귀가 노이즈 추종 가능. 영화내 Spearman으로 "곡선 모양" 위주 평가해 절대오차 과민 방지.
- **분포 불균형**(valence가 부정 쪽으로 약간 기움) → MSE로 충분, 필요 시 추후 가중.

---

## 7. 테스트 (TDD, 합성 소형 데이터)

- `test_features.py`: 5개 피처 산출 정확성(words_per_sec·avg_gap 계산), z-score fit/transform·save/load 라운드트립.
- `test_dataset.py`: **영화 단위 분할**이 같은 영화를 한 split에만 넣는지(누수 없음), 비율·시드 재현성, 두 축 결측 씬 제외.
- `test_model.py`: forward가 (B,2) 출력·범위 (0,1), numeric dim 결합 정상.
- `test_evaluate.py`: MAE·영화내 Spearman·Pearson 계산을 알려진 입력으로 검증.
- `test_train_main.py`: 모킹된 db + 초소형 데이터로 `run()`이 산출물 파일 생성 + model_versions upsert 호출(실제 학습은 1~2 step로 축소).

---

## 8. 범위 밖 (다음 서브프로젝트)

- F: KServe 서빙(PVC 산출물 로드, 추론 → scene_scores `roberta-va-v1::arousal/valence` 적재), 승격 게이트 실행.
- G: 표시단계 정규화/리샘플링 + 서비스 DB(movie_vectors) 적재.
- Ops: 재학습 CronWorkflow·매니저 트리거.
