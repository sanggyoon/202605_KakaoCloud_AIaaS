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
