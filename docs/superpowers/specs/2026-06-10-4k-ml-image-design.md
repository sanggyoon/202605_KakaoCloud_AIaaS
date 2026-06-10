# 4K_ML 이미지 + 파싱 WorkflowTemplate 설계 (ML 실행 토대 Spec 2)

**날짜:** 2026-06-10
**상태:** 승인됨
**상위 맥락:** Spec 1(Argo Workflows 설치, 완료) 위에서, 4K_ML을 컨테이너화하고 자막 파싱(C)을 vm5 GPU 워크플로로 실행한다. D(LLM)·E(학습) 템플릿은 같은 이미지/패턴으로 추후 추가.

## 배경 / 문제

C(자막 파싱) 코드는 4K_ML에 있으나 컨테이너/워크플로가 없어 vm5 GPU에서 돌릴 수 없다(현재 수동 CLI만). Argo Workflows 엔진은 설치됐으니, 이제 4K_ML 이미지를 만들고 GPU WorkflowTemplate로 파싱을 실행한다.

## 목표

- `4K_ML/Dockerfile`(CUDA+torch, all-MiniLM bake) + GitHub Actions CI(`deploy-4k-ml.yml` → ghcr).
- `subtitle-parse` WorkflowTemplate(ns `ai`)로 GPU에서 `python -m subtitle_parse.parse_subtitles` 실행.
- `4k-ml-secrets`(ai) + `argocd-app-4k-ml`로 GitOps 관리.

## 비목표 (YAGNI)

- D 라벨링·E 학습 WorkflowTemplate — 추후(같은 이미지·패턴).
- CronWorkflow 스케줄, 매니저 트리거/모니터링 — 추후(Ops).
- 멀티 GPU/분산 — T4 1장, 단일 워크플로.

## 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 베이스 이미지 | `pytorch/pytorch:2.x-cuda12.1-cudnn9-runtime` (torch+CUDA 내장) |
| 모델 | all-MiniLM-L6-v2 **이미지에 굽기**(런타임 다운로드 X) |
| CI | BE 패턴 미러: `4K_ML/**` push → `ghcr.io/sanggyoon/4k-ml:<sha>`(+latest) → WorkflowTemplate 이미지 태그 sha bump → `[skip ci]` |
| 실행 | per-step WorkflowTemplate, `subtitle-parse` 먼저, ns `ai` |
| GPU | `nodeSelector workload=gpu` + `runtimeClassName nvidia` + `nvidia.com/gpu:1` |
| SA | `argo-workflow` (Spec 1에서 생성) |
| DB 접속 | 내부 서비스 `http://supabase-ai-supabase-kong.ai:8000` (basic auth·외부 홉 없음) |
| Secret | `4k-ml-secrets`(ai, 수동): `AI_DATABASE_URL`(내부), `AI_DATABASE_KEY` |

## 컴포넌트 / 산출물

1. **`4K_ML/Dockerfile`**
   - `FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime` (정확한 태그는 구현 시 확정).
   - `pip install --no-cache-dir -r requirements.txt` (torch는 베이스에 있어 재설치 회피).
   - all-MiniLM bake: `RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"`.
   - `COPY` 코드(`subtitle_parse/`, `db/`, `generate_vectors/`). ENTRYPOINT 없음.
   - `.dockerignore`로 `.venv`·테스트·캐시 제외(이미지 비대화 방지).
2. **`.github/workflows/deploy-4k-ml.yml`** — BE CI 미러. 태그 bump 대상은 `Ansible/manifests/4k-ml/workflowtemplate-subtitle-parse.yaml`.
3. **`Ansible/manifests/4k-ml/workflowtemplate-subtitle-parse.yaml`** — `WorkflowTemplate subtitle-parse`(ai), GPU 리소스 + `envFrom 4k-ml-secrets` + `python -m subtitle_parse.parse_subtitles`.
4. **`Ansible/manifests/argocd/argocd-app-4k-ml.yaml`** — manifest path `Ansible/manifests/4k-ml`, dest ns `ai`.
5. **`4k-ml-secrets`** (ns `ai`, 수동 kubectl, git 외부).

## 데이터/제어 흐름

```
git push(4K_ML/**) → CI 이미지 빌드→ghcr→WorkflowTemplate 태그 bump→ArgoCD sync
argo submit --from workflowtemplate/subtitle-parse -n ai
  → ai ns GPU 파드(4k-ml 이미지) → python -m subtitle_parse.parse_subtitles
  → 내부 kong으로 vm5 DB 읽기/쓰기(parse_state!=done → scenes/dialogues 적재)
```

## 에러 처리 / 운영

- `4k-ml-secrets` 누락 → 파드 `CreateContainerConfigError` → 사전 생성.
- GPU 미가용(다른 워크로드 점유) → 파드 Pending → 완료 후 재실행.
- 파싱 코드 자체 오류는 기존 C 로직(`parse_state='failed'`)이 처리.
- 이미지 빌드 실패(베이스 태그/torch 충돌) → CI 로그로 확인, 베이스 태그 조정.

## 검증

1. CI 그린 + `ghcr.io/sanggyoon/4k-ml:<sha>` 푸시 확인.
2. ArgoCD `4k-ml` Synced, `kubectl get workflowtemplate -n ai`에 `subtitle-parse`.
3. `argo submit --from workflowtemplate/subtitle-parse -n ai --watch` → `Succeeded`.
4. GPU 사용 확인(파드 로그/`nvidia-smi` 또는 torch.cuda) + vm5 `scenes`/`dialogues` 적재 + `parse_state='done'`, 영화당 씬 40~70.

## 미해결 / 후속

- 정확한 pytorch 베이스 태그·요구사항 호환은 구현 시 확정(빌드로 검증).
- D/E WorkflowTemplate, CronWorkflow, 매니저 트리거 — 추후.
- 이미지 크기 최적화(멀티스테이지) 필요 시 추후.
