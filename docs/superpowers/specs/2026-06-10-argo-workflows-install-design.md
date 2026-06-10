# Argo Workflows 설치 설계 (ML 실행 토대 Spec 1)

**날짜:** 2026-06-10
**상태:** 승인됨
**상위 맥락:** vm5(GPU+AI DB) GPU 노드에서 4K_ML(파싱·라벨링·학습)을 실행하기 위한 토대. 2개 spec으로 분리한 것 중 **1번 — Argo Workflows 엔진 설치**. 2번(4K_ML 이미지 + 단계별 WorkflowTemplate)은 이 위에 올라간다.

## 배경 / 문제

클러스터에는 Argo CD(배포)만 있고 **Argo Workflows(워크플로 엔진)는 없다.** 무거운 ML 작업(C 파싱 sbert, D LLM, E RoBERTa 학습)을 vm5 GPU 노드에서 일괄/스케줄 실행하려면 워크플로 엔진이 필요하다. 이 spec은 엔진과 UI를 GitOps로 설치하고, 워크플로가 `ai` 네임스페이스(GPU·AI DB·시크릿 위치)에서 돌 수 있게 권한을 마련한다.

## 목표

- Argo Workflows(controller + server/UI)를 **ArgoCD Application + helm 차트**로 `argo` 네임스페이스에 설치.
- 워크플로를 **`ai` 네임스페이스에서 실행**할 수 있도록 SA + RBAC 구성.
- **UI를 `workflows.peakly.art`**로 노출(nginx basic auth, studio와 동일 패턴).
- hello-world 워크플로 1개를 `ai`에서 Succeeded까지 돌려 실행 경로 검증.

## 비목표 (YAGNI)

- 4K_ML 이미지/Dockerfile/CI, 단계별 WorkflowTemplate, GPU 잡 — **Spec 2**.
- 아티팩트 저장소(S3/minio) — 우리 워크플로는 단일 컨테이너가 DB(REST)에 직접 쓰므로 단계 간 아티팩트 불필요.
- SSO/OIDC — basic auth 게이트로 충분(기존 패턴).
- CronWorkflow 스케줄 — 추후(필요 시).

## 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 설치 방식 | ArgoCD Application → helm 차트 `argo/argo-workflows` |
| 네임스페이스 | 엔진 `argo`, 워크플로 실행 `ai` |
| 실행 범위 | 컨트롤러 클러스터 범위(다른 ns의 워크플로 실행 가능) |
| UI | argo-server 활성, `--auth-mode=server`, `--secure=false`(nginx가 TLS 종단) |
| UI 호스트 | `workflows.peakly.art` (basic auth) |
| basic auth | `supabase-dashboard-basic`과 **동일 자격** — 단 nginx는 인그레스와 같은 ns의 시크릿을 요구하므로 `argo` ns에 같은 시크릿 생성 |
| 아티팩트 저장소 | 미사용 |

## 컴포넌트 / 산출물

1. **`Ansible/manifests/argocd/argocd-app-argo-workflows.yaml`** — ArgoCD Application
   - source: helm repo `https://argoproj.github.io/argo-helm`, chart `argo-workflows`, 고정 버전.
   - destination ns `argo`, `CreateNamespace=true`, 자동 sync.
   - helm values(인라인): `server.enabled=true`, `server.authModes={server}`, `server.secure=false`,
     `controller.workflowNamespaces`(또는 클러스터 범위 기본), 아티팩트 미설정.
2. **`Ansible/manifests/argo-workflows/rbac-ai.yaml`** — `ai` ns 실행 권한
   - `ServiceAccount: argo-workflow` (ns `ai`)
   - `Role`(ns `ai`): 워크플로 executor 권한 — `pods`(create/get/list/watch/delete), `pods/log`(get/watch), `pods/exec`(create), `workflowtaskresults.argoproj.io`(create/patch/get).
   - `RoleBinding`: 위 Role → `argo-workflow` SA.
3. **`Ansible/manifests/argo-workflows/ingress.yaml`** — UI 인그레스(ns `argo`)
   - host `workflows.peakly.art`, backend `argo-workflows-server:2746`, `backend-protocol: HTTP`,
     `auth-type: basic` + `auth-secret: supabase-dashboard-basic`, cert-manager TLS(`argo-workflows-tls`).
4. **`argo` ns에 basic-auth 시크릿** — `supabase-dashboard-basic`과 동일 내용(htpasswd) 생성(수동, git 외부).
5. **kustomization/앱 등록** — 기존 패턴대로 ArgoCD가 위 매니페스트를 추적(argocd-app-infra 또는 신규 app).

## 데이터/제어 흐름

```
git(매니페스트) → ArgoCD sync → argo ns에 controller+server 설치
사용자 → https://workflows.peakly.art (basic auth) → argo-server UI
argo submit (-n ai) → controller가 ai ns에 워크플로 파드 생성(argo-workflow SA)
```

## 에러 처리 / 운영

- basic-auth 시크릿이 `argo` ns에 없으면 인그레스 401 — 설치 시 함께 생성.
- DNS `workflows.peakly.art` A레코드를 클러스터 인그레스 IP로(기존 *.peakly.art와 동일 관리).
- `ai` ns RBAC 누락 시 워크플로가 `pods is forbidden`으로 실패 → rbac-ai.yaml로 해결.
- argo-server `--secure=false` + nginx TLS 종단(backend-protocol HTTP) 일치 필요(불일치 시 502).

## 검증

1. ArgoCD에서 `argo-workflows` 앱 **Synced/Healthy**, `argo` ns에 controller·server 파드 Running.
2. 브라우저 `https://workflows.peakly.art` → basic auth 통과 후 UI 로드.
3. `ai` ns에 hello-world 워크플로 제출 → **Succeeded**:
   ```bash
   argo submit -n ai --serviceaccount argo-workflow --watch - <<'EOF'
   apiVersion: argoproj.io/v1alpha1
   kind: Workflow
   metadata: { generateName: hello- }
   spec:
     entrypoint: main
     templates:
       - name: main
         container: { image: busybox, command: [echo], args: ["argo on ai ok"] }
   EOF
   ```
   (또는 UI에서 동일 제출.)

## 미해결 / 후속 (Spec 2)

- 4K_ML Dockerfile(CUDA+torch, all-MiniLM bake) + GitHub Actions CI(ghcr) + 단계별 WorkflowTemplate(`subtitle-parse` 먼저) + `4k-ml-secrets`(ai) + GPU 리소스(`nodeSelector workload=gpu`, `runtimeClassName nvidia`, `nvidia.com/gpu:1`) + 내부 DB URL(`http://supabase-ai-supabase-kong.ai:8000`).
- helm 차트 정확한 버전·values 키는 구현 계획에서 차트 문서로 확정.
