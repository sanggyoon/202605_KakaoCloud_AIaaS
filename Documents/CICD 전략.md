# CI/CD 전략

> 4K Cinema 프로젝트의 지속적 통합·배포 전략 및 구현 기록

## 목차

1. [개요](#1-개요)
2. [파이프라인 전체 흐름](#2-파이프라인-전체-흐름)
3. [CI — GitHub Actions](#3-ci--github-actions)
4. [CD — ArgoCD](#4-cd--argocd)
5. [매니페스트 구조 (Kustomize)](#5-매니페스트-구조-kustomize)
6. [배포 대상 리소스](#6-배포-대상-리소스)
7. [GHCR 이미지 접근 설정](#7-ghcr-이미지-접근-설정)
8. [트리거별 동작 정리](#8-트리거별-동작-정리)
9. [트러블슈팅](#9-트러블슈팅)
10. [향후 개선 가능 항목](#10-향후-개선-가능-항목)

---

## 1. 개요

| 항목 | 선택 | 이유 |
|------|------|------|
| CI | GitHub Actions | 별도 서버 불필요, GHCR 통합, `GITHUB_TOKEN` 자동 제공 |
| CD | ArgoCD | 이미 클러스터에 구축됨, GitOps 선언적 관리, 자동 복원 |
| 이미지 레지스트리 | GHCR (`ghcr.io`) | GitHub Actions와 동일 생태계, 별도 인증 불필요 |
| 매니페스트 형식 | Kustomize | Helm 불필요 수준의 단순 앱, 이미지 태그 패치만 필요 |

### 파이프라인 목록

| 서비스 | 트리거 경로 | 이미지 | 매니페스트 경로 |
|---|---|---|---|
| 4K Cinema FE | `4K_FE/**` | `ghcr.io/sanggyoon/4k-cinema` | `Ansible/manifests/4k-cinema/` |
| 4K Backend BE | `4K_BE/**` | `ghcr.io/sanggyoon/4k-be` | `Ansible/manifests/4k-be/` |
| 4K ML | 없음 (수동 실행) | — | — |

> **4K_ML**은 CI/CD 대상이 아님. 로컬에서 `python generate_vectors/generate_vectors.py`를 직접 실행해 vm4 Supabase `movie_vectors` 테이블을 갱신한다.

---

## 2. 파이프라인 전체 흐름

### FE (4K Cinema)

```
개발자 로컬
  │
  │  git push (main, 4K_FE/** 경로 변경)
  ▼
GitHub (sanggyoon/202605_KakaoCloud_AIaaS)
  │
  │  .github/workflows/deploy-4k-fe.yml 트리거
  ▼
GitHub Actions Runner (ubuntu-latest)
  │
  ├─ ① Docker 빌드 (multi-stage, Next.js standalone)
  │     context: ./4K_FE
  │     cache: GitHub Actions Cache (BuildKit)
  │
  ├─ ② GHCR 푸시
  │     ghcr.io/sanggyoon/4k-cinema:<sha>   ← 불변 태그
  │     ghcr.io/sanggyoon/4k-cinema:latest  ← 가변 태그
  │
  ├─ ③ kustomization.yaml 태그 업데이트
  │     Ansible/manifests/4k-cinema/kustomization.yaml
  │     newTag: "abc1234" (git short SHA 7자)
  │
  └─ ④ git commit & push [skip ci]
         "ci: update 4k-cinema image → abc1234 [skip ci]"

ArgoCD (argocd.4kakao.kro.kr)
  │
  │  Git 폴링 (~3분 주기) → Ansible/manifests/4k-cinema/ 변경 감지
  ▼
K3s 클러스터 (fe 네임스페이스)
  │
  └─ kubectl apply -k Ansible/manifests/4k-cinema/
       → Deployment 롤링 업데이트 (2 replica)
       → Pod: vm2 또는 vm3 (workload=app)
       → 도메인: https://cinema.4kakao.kro.kr
```

### BE (4K Backend)

```
개발자 로컬
  │
  │  git push (main, 4K_BE/** 경로 변경)
  ▼
GitHub (sanggyoon/202605_KakaoCloud_AIaaS)
  │
  │  .github/workflows/deploy-4k-be.yml 트리거
  ▼
GitHub Actions Runner (ubuntu-latest)
  │
  ├─ ① Docker 빌드 (python:3.11-slim)
  │     context: ./4K_BE
  │     cache: GitHub Actions Cache (BuildKit)
  │
  ├─ ② GHCR 푸시
  │     ghcr.io/sanggyoon/4k-be:<sha>   ← 불변 태그
  │     ghcr.io/sanggyoon/4k-be:latest  ← 가변 태그
  │
  ├─ ③ kustomization.yaml 태그 업데이트
  │     Ansible/manifests/4k-be/kustomization.yaml
  │     newTag: "abc1234" (git short SHA 7자)
  │
  └─ ④ git commit & push [skip ci]
         "ci: update 4k-be image → abc1234 [skip ci]"

ArgoCD (argocd.4kakao.kro.kr)
  │
  │  Git 폴링 (~3분 주기) → Ansible/manifests/4k-be/ 변경 감지
  ▼
K3s 클러스터 (be 네임스페이스)
  │
  └─ kubectl apply -k Ansible/manifests/4k-be/
       → Deployment 롤링 업데이트
       → Pod: vm2 또는 vm3 (workload=app)
       → ClusterIP Service만 생성 (외부 노출 없음)
       → FE Next.js → http://backend.be.svc.cluster.local:8000 내부 호출
```

---

## 3. CI — GitHub Actions

### 트리거 조건

FE (`deploy-4k-fe.yml`):
```yaml
on:
  push:
    branches: [main]
    paths:
      - '4K_FE/**'
      - '.github/workflows/deploy-4k-fe.yml'
```

BE (`deploy-4k-be.yml`):
```yaml
on:
  push:
    branches: [main]
    paths:
      - '4K_BE/**'
      - '.github/workflows/deploy-4k-be.yml'
```

- `main` 브랜치에 push할 때만 실행
- 해당 서비스 경로 또는 워크플로우 파일 자체가 변경된 경우에만 실행
- `Ansible/`, `Documents/` 등 다른 경로 변경은 CI 미트리거

### 권한 모델

```yaml
permissions:
  contents: write   # kustomization.yaml 커밋·푸시
  packages: write   # GHCR 이미지 푸시
```

별도 Secret 설정 없이 `GITHUB_TOKEN`만으로 동작.

### 이미지 태그 전략

| 태그 | 예시 | 특성 |
|------|------|------|
| git short SHA | `abc1234` | 불변. ArgoCD가 이 태그를 사용 |
| `latest` | `latest` | 가변. 수동 테스트·확인용 |

ArgoCD는 항상 SHA 태그를 사용하므로 `latest` 태그가 바뀌어도 클러스터 상태는 변하지 않음.

### Docker 빌드 최적화

```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

GitHub Actions Cache를 BuildKit 레이어 캐시로 사용. `npm install` 레이어가 캐시되면 빌드 시간 대폭 단축.

### 무한루프 방지

```
git commit -m "ci: update 4k-cinema image → abc1234 [skip ci]"
```

kustomization.yaml 업데이트 커밋에 `[skip ci]` 태그를 붙여 GitHub Actions 재트리거 차단.

---

## 4. CD — ArgoCD

### Application 설정

FE (`argocd-app-4k-cinema.yaml`):
```yaml
spec:
  source:
    repoURL: https://github.com/sanggyoon/202605_KakaoCloud_AIaaS.git
    targetRevision: main
    path: Ansible/manifests/4k-cinema   # Kustomize 자동 인식
  destination:
    server: https://kubernetes.default.svc
    namespace: fe
  syncPolicy:
    automated:
      prune: true      # Git에서 삭제된 리소스는 클러스터에서도 삭제
      selfHeal: true   # 수동 변경 시 Git 상태로 자동 복원
    syncOptions:
      - CreateNamespace=true
```

BE (`argocd-app-4k-be.yaml`):
```yaml
spec:
  source:
    repoURL: https://github.com/sanggyoon/202605_KakaoCloud_AIaaS.git
    targetRevision: main
    path: Ansible/manifests/4k-be       # Kustomize 자동 인식
  destination:
    server: https://kubernetes.default.svc
    namespace: be
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

> BE Application은 아직 클러스터에 미등록. `kubectl apply -f Ansible/manifests/argocd/argocd-app-4k-be.yaml` 필요.

### 이미지 태그 업데이트 경로

```
GitHub Actions
  → Ansible/manifests/4k-cinema/kustomization.yaml 수정 (newTag 변경)
  → git push
  → ArgoCD 감지 (~3분)
  → Deployment 이미지 태그 변경 → 롤링 업데이트
```

Kustomize `images` 패치 방식이므로 `deployment.yaml`의 이미지 필드는 베이스 이름만 기재하고, 실제 태그는 `kustomization.yaml`이 주입.

### sync 상태 확인

```bash
kubectl get application 4k-cinema -n argocd
# 또는 ArgoCD UI: https://argocd.4kakao.kro.kr
```

| 상태 | 의미 |
|------|------|
| `Synced / Healthy` | 정상. Git 상태 = 클러스터 상태 |
| `OutOfSync` | Git 변경 감지, sync 대기 중 (자동 처리) |
| `Degraded` | Pod 기동 실패 등 이상. 로그 확인 필요 |

---

## 5. 매니페스트 구조 (Kustomize)

```
Ansible/manifests/4k-cinema/
├── kustomization.yaml   ← CI가 newTag 자동 업데이트
├── deployment.yaml      (BE_INTERNAL_URL 환경변수 포함)
├── service.yaml
└── ingress.yaml         (letsencrypt-prod, ssl-redirect: true)

Ansible/manifests/4k-be/
├── kustomization.yaml   ← CI가 newTag 자동 업데이트
├── deployment.yaml      (ClusterIP only, /health probe)
└── service.yaml
```

### kustomization.yaml 이미지 패치

```yaml
images:
  - name: ghcr.io/sanggyoon/4k-cinema
    newTag: "abc1234"   # GitHub Actions가 매 배포마다 갱신
```

---

## 6. 배포 대상 리소스

### FE (fe 네임스페이스)

| 리소스 | 설정 |
|--------|------|
| Deployment | `replicas: 2`, `nodeSelector: workload=app` (vm2/vm3), `BE_INTERNAL_URL` 환경변수 |
| Service | `ClusterIP`, port 80 → pod 3000 |
| Ingress | `cinema.4kakao.kro.kr`, `ingressClassName: nginx`, TLS: `letsencrypt-prod`, `ssl-redirect: true` |

### BE (be 네임스페이스)

| 리소스 | 설정 |
|--------|------|
| Deployment | `replicas: 1`, `nodeSelector: workload=app` (vm2/vm3), `/health` readiness/liveness probe |
| Service | `ClusterIP`, port 8000 → pod 8000. Ingress 없음 — 클러스터 내부에서만 접근 |

### 롤링 업데이트 기본 동작

- 기존 Pod를 하나씩 교체 (다운타임 없음)
- `readinessProbe` 통과 후 트래픽 전환
- 실패 시 자동으로 이전 ReplicaSet으로 롤백 가능

```bash
# 롤백 (이전 버전으로)
kubectl rollout undo deployment/frontend -n fe

# 특정 버전으로 롤백
kubectl rollout history deployment/frontend -n fe
kubectl rollout undo deployment/frontend -n fe --to-revision=2
```

---

## 7. GHCR 이미지 접근 설정

### Public 패키지인 경우 (권장)

추가 설정 없이 k3s 노드에서 바로 pull 가능.

GitHub → Profile → Packages → `4k-cinema` → Package settings → **Change visibility → Public**

### Private 패키지인 경우

```bash
# GitHub PAT 생성: Settings → Developer settings → PAT (read:packages 권한)

kubectl create secret docker-registry ghcr-secret \
  --namespace fe \
  --docker-server=ghcr.io \
  --docker-username=sanggyoon \
  --docker-password=<GITHUB_PAT>
```

`deployment.yaml`에 아래 추가 후 git push:

```yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: ghcr-secret
```

---

## 8. 트리거별 동작 정리

| 상황 | 동작 |
|------|------|
| `4K_FE/` 코드 변경 후 main push | CI 자동 실행 → 이미지 빌드 → 배포 |
| `Ansible/manifests/4k-cinema/*.yaml` 직접 수정 후 push | ArgoCD가 감지 → 클러스터 적용 (CI 미실행) |
| 클러스터에서 수동 `kubectl edit` | ArgoCD selfHeal이 Git 상태로 복원 |
| `kustomization.yaml` newTag 수동 변경 push | ArgoCD가 해당 SHA 태그 이미지로 배포 |
| main 외 브랜치 push | CI/CD 미트리거 |

---

## 9. 트러블슈팅

| 증상 | 확인사항 |
|------|----------|
| GitHub Actions 실패 — GHCR push 권한 오류 | Repository Settings → Actions → General → Workflow permissions → `Read and write permissions` 확인 |
| GitHub Actions 실패 — git push 권한 오류 | 동일. Workflow permissions 확인 |
| ArgoCD OutOfSync 해소 안 됨 | `Ansible/manifests/4k-cinema/` 경로·repoURL 오타, Git 인증 확인 |
| Pod `ImagePullBackOff` | GHCR 패키지 visibility(Public/Private), imagePullSecret 확인 |
| Pod `CrashLoopBackOff` | `kubectl logs -n fe -l app=frontend` → Next.js 빌드 오류 or 환경변수 누락 |
| TLS 인증서 미발급 | `kubectl describe certificate -n fe`, cert-manager 80포트 HTTP-01 챌린지 확인 |
| 배포 후 구버전 응답 | `kubectl get pods -n fe -o wide`로 Pod 갱신 여부 확인, `kubectl rollout status deployment/frontend -n fe` |

---

## 10. 향후 개선 가능 항목

| 항목 | 방법 |
|------|------|
| BE ArgoCD 등록 | `kubectl apply -f Ansible/manifests/argocd/argocd-app-4k-be.yaml` (1회) |
| 개인 도메인 | kro.kr → 개인 도메인 구매 시 rate limit 문제 근본 해결 |
| 이미지 취약점 스캔 | GitHub Actions에 `aquasecurity/trivy-action` 추가 |
| PR 환경 자동 생성 | ArgoCD ApplicationSet + PR 브랜치 연동 |
| 롤백 자동화 | Argo Rollouts로 카나리/블루그린 배포 + 자동 롤백 |
| 빌드 시간 단축 | Dockerfile에 `--mount=type=cache` 추가 또는 self-hosted runner |
