# KakaoCloud AIaaS Project

KakaoCloud 기반 K3s 클러스터 위에 구축한 **4K Cinema** 영화 추천 서비스와 전체 인프라를 관리하는 모노레포.

---

## 라이브 서비스

| 서비스 | URL | 인증 |
|---|---|---|
| 4K Cinema (FE) | https://peakly.art | 없음 (공개) |
| Supabase data Studio | https://data.peakly.art | Basic Auth |
| Supabase ai Studio | https://ai.peakly.art | Basic Auth |
| Grafana | https://grafana.peakly.art | Grafana 자체 인증 |
| ArgoCD | https://argocd.peakly.art | ArgoCD 자체 인증 |

---

## 기술 스택

| 계층 | 기술 |
|---|---|
| Frontend | Next.js 16, TypeScript, App Router |
| Backend | FastAPI, Python 3.11, Uvicorn |
| Database | Supabase (PostgreSQL + pgvector), Redis |
| Infrastructure | KakaoCloud VM × 5, K3s v1.30, Ansible |
| CI | GitHub Actions, GHCR (`ghcr.io/sanggyoon`) |
| CD | ArgoCD (GitOps), Kustomize |
| Monitoring | Prometheus, Grafana, Loki, Promtail |
| TLS | cert-manager + Let's Encrypt (letsencrypt-prod) |

---

## 배포 파이프라인 요약

```
git push (main)
  → GitHub Actions: Docker 빌드 → GHCR 푸시 → kustomization.yaml 태그 커밋
  → ArgoCD: Git 변경 감지 (~3분) → K3s 롤링 업데이트
```

---

## 저장소 구조

```
KakaoCloud_Project/
├── .github/workflows/
│   ├── deploy-4k-fe.yml        # FE CI/CD (4K_FE/** 변경 시 트리거)
│   └── deploy-4k-be.yml        # BE CI/CD (4K_BE/** 변경 시 트리거)
├── 4K_FE/                      # Next.js 16 프론트엔드
├── 4K_BE/                      # FastAPI 백엔드
├── Ansible/
│   ├── playbooks/              # K3s 클러스터 프로비저닝
│   ├── manifests/              # ArgoCD가 관리하는 K8s 매니페스트
│   └── values/                 # ArgoCD가 참조하는 Helm values
└── Documents/                  # 프로젝트 문서
```

---

## 문서

| 문서 | 내용 |
|---|---|
| [서비스 개요](Documents/서비스%20개요.md) | 4K Cinema 서비스 기능·화면 구성 |
| [프로젝트 디렉토리 구조](Documents/프로젝트%20디렉토리%20구조.md) | 전체 파일 구조 및 각 경로의 역할 |
| [인프라 구축 기록](Documents/인프라%20구축%20기록.md) | 클러스터 구성, 네트워크, 스토리지, 트러블슈팅 이력 |
| [인프라 구축 방법(명령어)](Documents/인프라%20구축%20방법(명령어).md) | 처음부터 재구축 시 순서대로 실행할 명령어 모음 |
| [CI/CD 전략](Documents/CICD%20전략.md) | GitHub Actions + ArgoCD 파이프라인 설계 |

---

## 클러스터 구성

| VM | 역할 | Private IP | Public IP |
|---|---|---|---|
| vm1 | Control Plane + Ingress + NAT | 10.1.1.10 | 210.109.83.10 |
| vm2 | Worker (FE/BE) | 10.1.3.10 | - |
| vm3 | Worker (FE/BE) | 10.1.4.10 | - |
| vm4 | Worker (Data/DB) | 10.1.5.10 | - |
| vm5 | Worker (GPU/AI) — Tesla T4 | 10.1.7.10 | - |

---

## 빠른 명령어 참고

```bash
# kubeconfig 설정
export KUBECONFIG=$(pwd)/Ansible/kubeconfig

# 전체 Pod 상태 확인
kubectl get pods -A

# ArgoCD Application 상태 확인
kubectl get applications -n argocd

# FE 로그 확인
kubectl logs -n fe -l app=frontend --tail=50

# BE 로그 확인
kubectl logs -n be -l app=backend --tail=50

# 비밀번호 조회
kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 -d; echo
kubectl get secret kube-prometheus-stack-grafana -n monitoring -o jsonpath="{.data.admin-password}" | base64 -d; echo
```
