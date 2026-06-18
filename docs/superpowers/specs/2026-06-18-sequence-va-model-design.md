# 문맥 인지 시퀀스 VA 모델 `roberta-va-v2` 설계

작성일: 2026-06-18
상태: 설계 승인됨
관련: [2026-06-11-roberta-training-design.md](2026-06-11-roberta-training-design.md)(v1), [2026-06-10-llm-labeling-va-design.md](2026-06-10-llm-labeling-va-design.md)(라벨)

## 목적

클라이맥스 곡선의 **모양 정확도(영화내 Spearman)** 를 높인다. 특히 약한 축인
**valence**.

### 진단 (왜 이 방향인가)

- LLM 교사(`llm-va-v1`)는 **영화 전체 씬을 한꺼번에 보고** 맥락을 활용해 라벨을 매긴다
  (`labeling/prompt.py`: "You see the entire movie's scenes at once"). → 라벨 천장은 충분.
- 그러나 학생 `roberta-va-v1`은 **씬을 IID(하나씩 독립)** 로 채점한다. 교사가 쓴
  영화 맥락을 학생은 못 본다. → 구조적으로 교사를 따라갈 수 없음.
- v1의 `progress_ratio` 피처는 **위치 좌표**(0~1)일 뿐, **이웃 씬의 실제 내용**이
  아니다. 같은 대사도 앞뒤 맥락에 따라 valence가 정반대가 되는데, 위치 숫자로는
  구분 불가. → valence(0.66)가 arousal(0.75)보다 약한 주원인.

**해결:** 학생에게도 이웃/시퀀스 문맥을 보게 한다. 라벨은 그대로 재사용 → **LLM 비용 0**.

### v1 베이스라인 (같은 test split, n_test=5646)

| 지표 | arousal | valence |
|---|---|---|
| MAE | 0.0878 | 0.0899 |
| Pearson | 0.796 | 0.738 |
| **영화내 Spearman** | **0.751** | **0.660** |

## 배경 / 확정 사실

- 학습: `4K_ML/train/` — `model.py`(HybridRobertaRegressor: RoBERTa CLS ⊕ 숫자 5 →
  MLP → sigmoid 2출력), `train_model.py`, `dataset.py`(영화 단위 split, IID Dataset),
  `features.py`(숫자 5피처 + z-score Scaler), `evaluate.py`(mae/pearson/movie_spearman),
  `db.py`(`fetch_movie_scenes`는 scene_index 순 정렬로 movie_id·text·피처·arousal·valence 반환).
- 라벨: `llm-va-v1::arousal` / `::valence` (vm5 scene_scores). 학습 입력 라벨.
- 서빙: `4K_ML/serving/` — `predict_core.py`(`load_artifacts`, `score_instances`),
  `score_scenes.py`(영화별로 정렬된 씬 묶음을 predictor에 넘겨 채점 후 vm5에 기록).
  → **서빙은 이미 영화 단위·정렬** 이라 시퀀스 추론에 적합.
- 산출물: PVC에 `model.safetensors`/`scaler.json`/`config.json`/`split.json` + 토크나이저.
  `model_versions`에 metrics 기록(`db.upsert_model_version`).
- 활성 버전: `model_versions.active=true`(base) → 재스코어링·벡터·FE가 이를 따름.
- 인프라: Argo Workflow(GPU) 학습, KServe 서빙, GPU 배치 재스코어링, generate_vectors.
- 코드 작성 전 관련 모듈 재확인. 테스트 러너는 이번 정리에서 제거됨 → 검증은
  `python -m py_compile` + 소규모 로컬 스모크(가능 시).

## 결정 사항

1. **인코더 동결**: v1의 fine-tuned RoBERTa 인코더를 **특징 추출기로 재사용**, 씬
   임베딩을 1회 사전계산. 그 위 **시퀀스 헤드만 학습**. (영화 통째 fine-tune은 메모리
   폭발 → 동결이 tractable. 끝까지 fine-tune은 범위 밖/후속.)
2. **시퀀스 헤드 = BiLSTM**(양방향). Transformer 아님(첫 버전은 단순·견고 우선).
3. **신버전 `roberta-va-v2`**, v1과 **같은 test split에서 A/B 비교**, 더 좋을 때만 promote.
4. **랭킹 손실(C)은 범위 밖** — MSE만. 후속 개선으로 남김.
5. **라벨 재신규 없음** — 기존 `llm-va-v1` 재사용.

## 상세 설계

### ① 모델 (`train/model.py`에 신클래스 추가)

`SeqRobertaRegressor` — 학습·서빙 공유(train/serve skew 차단, 기존 패턴):

```
씬 텍스트 ─[RoBERTa 인코더(동결)]→ CLS 임베딩(768)
                                    ⊕ 숫자피처(5)
  → 입력 사영 Linear(773 → d)        (d 예: 256)
  → BiLSTM(층 2, hidden d, bidirectional, dropout)   ← 영화 씬 순서 전체
  → 씬별 hidden(2d) → Linear(2d → 2) → Sigmoid → (arousal, valence)
```

- 입력: 한 영화의 **scene_index 순 정렬** 씬 시퀀스. 길이 가변 → 패딩 + 마스크.
- 인코더 동결(`requires_grad=False`); 학습 파라미터는 사영 Linear + BiLSTM + 출력 Linear.
- forward 시그니처(개념): `forward(scene_embs, numeric, lengths) -> (B, T, 2)`.
  - 임베딩을 미리 계산해 넘기는 형태(아래 사전계산 참조). 서빙도 동일 경로.

### ② 사전계산 (임베딩 캐시)

- 인코더가 동결이므로 각 씬의 CLS 임베딩(768)을 **1회 계산**해 메모리/디스크에 보관 후
  여러 epoch 재사용 → 학습 빠름, GPU 부담 적음.
- 모듈: `train/embed.py`(신규) — `compute_scene_embeddings(records, encoder, tok, max_len)`
  → `{scenes_id: np.ndarray(768)}` 또는 records에 `emb` 부착.
- 인코더 출처: v1 산출물 디렉터리(`MODEL_OUT_DIR`의 v1 또는 별도 `V1_MODEL_DIR`)에서
  로드한 fine-tuned 인코더. 없으면 폴백으로 `roberta-base`(비권장, config에 명시).

### ③ 데이터셋 (`train/dataset.py`에 추가)

- `MovieSequenceDataset` — 레코드를 movie_id로 묶어 **영화당 1 샘플**(시퀀스).
  - 항목: `embs(T,768)`, `numeric(T,5)`(scaler.transform), `target(T,2)`, `mask(T)`,
    `movie_id`, `scene_index` 순.
- 콜레이트 함수 `collate_movies(batch)` — 가변 T 패딩 + `lengths`/`mask` 생성
  (BiLSTM은 `pack_padded_sequence` 또는 mask 사용).
- 분할은 **기존 `split_movies` 재사용**(같은 seed → v1과 동일 train/val/test).

### ④ 학습 루프 (`train/train_model.py` 확장 또는 `train_seq.py` 신규)

- 흐름: 라벨 영화 로드 → split → train 임베딩 사전계산 → Scaler.fit(train) →
  `MovieSequenceDataset` + `collate_movies` → BiLSTM 헤드 학습.
- 손실: **마스킹 MSE**(패딩 제외) on (arousal, valence).
- 최적화: AdamW(헤드만), 조기종료는 **val 기준**(val MAE 또는 val movie-Spearman; 곡선
  모양 목표라 movie-Spearman 권장, MAE도 로깅).
- 산출물 저장: `model.safetensors`에 **전체 모델(동결 인코더 + BiLSTM 헤드) state_dict를
  함께 저장** → 서빙이 v1 디렉터리 의존 없이 자기완결로 로드. `scaler.json`,
  `config.json`(`model_version: roberta-va-v2`, 모델종류=seq, 인코더 출처, d/층수/max_len 등),
  `split.json`, 토크나이저.
- **test 평가**: 같은 지표(`evaluate.mae/pearson/movie_spearman`)를 test split에 계산해
  `model_versions`(`roberta-va-v2`)에 기록.

### ⑤ 서빙 (`serving/predict_core.py`, `score_scenes.py`)

- `load_artifacts` 확장: config의 모델 종류에 따라 `SeqRobertaRegressor` 로드(+동결 인코더).
- `score_instances` → **시퀀스 추론**: 한 영화의 정렬 씬 리스트를 받아 인코더로 임베딩
  → BiLSTM → 씬별 점수. `score_scenes.py`는 이미 영화별 정렬 씬을 넘기므로 호출부 변경 최소.
- 입력은 **반드시 scene_index 순서** 보장(서빙 입력 정렬 확인).

### ⑥ 버전 · 롤아웃

- 신버전 `roberta-va-v2`(+ 채점 출력 `roberta-va-v2::arousal`/`::valence`).
- 학습 후 metrics가 v1보다 좋으면(성공 기준 ⑦) `model_versions.active`를 v2로 전환(promote).
- promote 후: 전체 재스코어링(기존 GPU 배치 `score_scenes`) → 벡터 재생성
  (`generate_vectors`) → FE는 `getActiveVersion`으로 자동 반영. **promote 전까지 운영 무영향.**

### ⑦ 성공 기준

- 같은 test split에서 v1 대비 **영화내 Spearman 향상**:
  - 1차 목표: **valence Spearman ≥ 0.70**(v1 0.66), arousal ≥ 0.75(유지/향상).
- MAE는 v1 대비 **+0.01 이내**(크게 나빠지지 않음).
- 미달 시 promote 보류, 설계 재검토(층수/d/조기종료 기준/문맥 윈도우 보강 등).

## 검증

- `python -m py_compile` (변경 모듈).
- 로컬 스모크(가능 시): 소수 영화로 임베딩 사전계산→시퀀스 1 epoch→`evaluate` 호출이
  에러 없이 도는지. GPU 없으면 CPU·축소 설정으로 형상(shape)·마스킹만 점검.
- 학습 산출물의 metrics를 v1과 표로 비교(A/B).

## 범위 밖 (YAGNI)

- 인코더 end-to-end fine-tune(메모리·비용 큼) — 후속.
- 랭킹/상관 손실(C), Transformer 헤드 — 후속.
- 라벨 재생성/교사 교체 — 불필요(기존 라벨 충분).
- FE 변경 — active 버전 자동 반영이라 없음.
