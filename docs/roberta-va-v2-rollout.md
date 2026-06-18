# roberta-va-v2 롤아웃 런북

문맥 인지 시퀀스 모델을 학습→A/B→전환→재스코어링→벡터→FE 토글하는 절차.
**FE 토글(7) 전까지 운영(FE)은 v1 그대로** — 안전.

## 활성 버전 출처 2곳 (순서의 핵심)
- **vm5 `model_versions.active`** → ML 파이프라인(재스코어링·벡터 생성)이 읽음.
- **vm4 `app_config.active_model_version`** → **FE**(`getActiveVersion`)가 읽음. 코드 아님, 데이터.
- 둘은 별개라 **둘 다** 바꿔야 완전 전환. 특히 FE용(vm4)은 **v2 벡터가 생긴 뒤 맨 마지막**.

## 0. 사전조건
- 코드(train_seq, 서빙 분기)가 main 머지 → CI가 `ghcr.io/sanggyoon/4k-ml:<sha>` 빌드.
- `workflowtemplate-train-roberta-seq.yaml`의 image를 그 `<sha>`로 설정 후 적용
  (`kubectl apply -f` 또는 ArgoCD 동기화). `/models/roberta-va-v1` 산출물 존재 확인.

## 1. v2 학습 (GPU — Argo)
```
argo submit --from workflowtemplate/train-roberta-seq -n ai --wait
```
완료 후 산출물 `/models/roberta-va-v2`, vm5 `model_versions["roberta-va-v2"]`에 metrics 기록.

## 2. A/B 비교 — 승격 게이트 (CLI, Argo 아님)
```
python -m serving.promote roberta-va-v1 roberta-va-v2
```
vm5에서 두 버전 metrics를 읽어 **승격 OK/NO + 이유만 출력**(아무것도 바꾸지 않음).
vm5 접근만 되면 로컬 실행 가능(또는 4k-ml 이미지로 일회성 파드).
**성공 기준**: v2 movie-Spearman(valence ≥ 0.70, arousal ≥ 0.75), MAE는 v1 대비 +0.01 이내.
미달이면 중단하고 하이퍼파라미터(lstm_layers/proj/lr/조기종료 기준) 조정 후 1로 복귀.

## 3. 서빙 전환 (GitOps)
- KServe predictor의 `MODEL_DIR`이 `/models/roberta-va-v2`를 보도록 매니페스트 수정 → 배포.
  서빙이 v2 모델·`model_version=roberta-va-v2`를 응답. (재스코어링이 이 응답으로 v2 점수를 적재)

## 4. vm5 active 전환 (파이프라인용)
- vm5 `model_versions.active`를 base `roberta-va-v2`로 설정(v1 active=false).
  generate-vectors가 v2 점수를 골라 벡터를 만들게 한다.

## 5. 전체 재스코어링 (Argo)
```
argo submit --from workflowtemplate/score-scenes-gpu -n ai --wait
```
서빙(3)이 v2라 `scene_scores`에 `roberta-va-v2::arousal`/`::valence` 적재.

## 6. 벡터 재생성 (Argo)
```
argo submit --from workflowtemplate/generate-vectors -n ai --wait
```
vm4 `movie_vectors`에 `roberta-va-v2::*` 생성. **이게 끝나야 FE가 v2를 읽어도 그래프가 나온다.**

## 7. FE 전환 — vm4 app_config 토글 (맨 마지막!)
- vm4 `app_config.active_model_version` 값을 `'roberta-va-v2'`로 UPDATE(FE 코드 변경 없음).
  ```sql
  update app_config set value = 'roberta-va-v2' where key = 'active_model_version';
  ```
- FE `getActiveVersion`이 1회 캐시 후 읽으므로, 배포 재시작 또는 캐시 만료 시 v2 곡선/유사도 반영.
- **6 완료 전에 7을 하면** FE가 아직 없는 `roberta-va-v2::*` 벡터를 조회 → 빈 그래프. 반드시 6 다음.

## 롤백
- vm4 `app_config.active_model_version`를 `'roberta-va-v1'`로, vm5 `model_versions.active`를 v1로,
  predictor `MODEL_DIR`를 v1로 복구. v1 벡터(`roberta-va-v1::*`)는 남아 있어 즉시 복귀 가능.
