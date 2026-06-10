# Argo Workflows 설치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Argo Workflows(controller + UI)를 ArgoCD GitOps로 `argo` 네임스페이스에 설치하고, `ai` 네임스페이스에서 워크플로를 실행할 권한과 basic-auth UI(`workflows.peakly.art`)를 마련한다.

**Architecture:** 기존 `supabase-ai` 앱과 동일한 helm 멀티소스 패턴(chart + git의 `$values`)으로 Argo Workflows 차트를 설치. RBAC(ai ns)·UI 인그레스(argo ns)는 plain 매니페스트로 `Ansible/manifests/apps/`에 두어 기존 `infra-manifests` ArgoCD 앱이 동기화. basic-auth 시크릿은 ns별로 필요해 `argo` ns에 복제(수동).

**Tech Stack:** Argo Workflows(helm `argo/argo-workflows`), ArgoCD, nginx-ingress, cert-manager. (코드/테스트 없음 — k8s 매니페스트 + 클러스터 적용·검증.)

**Spec:** `docs/superpowers/specs/2026-06-10-argo-workflows-install-design.md`

**작업 디렉터리:** 매니페스트는 리포에 작성(커밋은 리포 루트). 클러스터 적용(kubectl/argo)·DNS·시크릿은 사용자(vm 접근 필요) 핸드오프.

**검증 방법 주의:** 이 작업은 사용자 k3s 클러스터에 적용된다. 매니페스트 작성은 YAML 유효성으로 확인하고, 실제 Sync/UI/워크플로 동작은 Task 5(운영 핸드오프)에서 사용자가 검증한다.

---

## File Structure

- Create: `Ansible/values/values-argo-workflows.yaml` — helm values
- Create: `Ansible/manifests/argocd/argocd-app-argo-workflows.yaml` — ArgoCD Application(차트 설치)
- Create: `Ansible/manifests/apps/argo-workflow-rbac-ai.yaml` — `ai` ns SA + Role + RoleBinding
- Create: `Ansible/manifests/apps/argo-workflows-ingress.yaml` — UI 인그레스(argo ns)

---

## Task 1: helm values + ArgoCD Application

**Files:**
- Create: `Ansible/values/values-argo-workflows.yaml`
- Create: `Ansible/manifests/argocd/argocd-app-argo-workflows.yaml`

- [ ] **Step 1: 차트 최신 버전 확인** (targetRevision에 넣을 값 확보)

Run:
```bash
helm repo add argo https://argoproj.github.io/argo-helm 2>/dev/null; helm repo update argo
helm search repo argo/argo-workflows | head
```
Expected: `argo/argo-workflows  <CHART_VERSION>  <APP_VERSION>` 한 줄. 출력된 `CHART_VERSION`을 Step 3 `targetRevision`에 사용. (예시일 뿐 — 실제 출력값으로 교체.)

- [ ] **Step 2: helm values 작성**

`Ansible/values/values-argo-workflows.yaml`:

```yaml
# Argo Workflows helm values — ArgoCD가 $values로 참조.
singleNamespace: false        # 클러스터 범위: ai 등 다른 ns의 워크플로 실행 허용
crds:
  install: true
  keep: true
server:
  enabled: true
  authModes:
    - server                  # basic-auth 인그레스가 게이트, 서버는 자체 SA 사용
  extraArgs:
    - --secure=false          # nginx가 TLS 종단 → 서버는 HTTP(2746)
```

- [ ] **Step 3: ArgoCD Application 작성** (supabase-ai 멀티소스 패턴)

`Ansible/manifests/argocd/argocd-app-argo-workflows.yaml` — `targetRevision`은 Step 1에서 확인한 CHART_VERSION으로 채운다:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: argo-workflows
  namespace: argocd
spec:
  project: default
  sources:
    - repoURL: https://argoproj.github.io/argo-helm
      chart: argo-workflows
      targetRevision: "0.45.4"   # ← Step 1의 helm search 출력값으로 교체
      helm:
        valueFiles:
          - $values/Ansible/values/values-argo-workflows.yaml
    - repoURL: https://github.com/sanggyoon/202605_KakaoCloud_AIaaS.git
      targetRevision: main
      ref: values
  destination:
    server: https://kubernetes.default.svc
    namespace: argo
  syncPolicy:
    automated:
      prune: false
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

- [ ] **Step 4: YAML 유효성 확인**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
python3 -c "import yaml; list(yaml.safe_load_all(open('Ansible/values/values-argo-workflows.yaml'))); list(yaml.safe_load_all(open('Ansible/manifests/argocd/argocd-app-argo-workflows.yaml'))); print('YAML OK')"
```
Expected: `YAML OK`

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/values/values-argo-workflows.yaml Ansible/manifests/argocd/argocd-app-argo-workflows.yaml
git commit -m "feat(infra): Argo Workflows ArgoCD app + helm values"
```

---

## Task 2: `ai` 네임스페이스 워크플로 RBAC

**Files:**
- Create: `Ansible/manifests/apps/argo-workflow-rbac-ai.yaml`

- [ ] **Step 1: SA + Role + RoleBinding 작성**

`Ansible/manifests/apps/argo-workflow-rbac-ai.yaml`:

```yaml
# ai ns에서 워크플로 파드를 실행하기 위한 ServiceAccount + 권한.
apiVersion: v1
kind: ServiceAccount
metadata:
  name: argo-workflow
  namespace: ai
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: argo-workflow-executor
  namespace: ai
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch", "create", "delete", "patch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get", "watch"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create"]
  - apiGroups: ["argoproj.io"]
    resources: ["workflowtaskresults"]
    verbs: ["create", "patch", "get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: argo-workflow-executor
  namespace: ai
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: argo-workflow-executor
subjects:
  - kind: ServiceAccount
    name: argo-workflow
    namespace: ai
```

- [ ] **Step 2: YAML 유효성 확인**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
python3 -c "import yaml; list(yaml.safe_load_all(open('Ansible/manifests/apps/argo-workflow-rbac-ai.yaml'))); print('YAML OK')"
```
Expected: `YAML OK`

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/manifests/apps/argo-workflow-rbac-ai.yaml
git commit -m "feat(infra): ai ns 워크플로 ServiceAccount + RBAC"
```

---

## Task 3: UI 인그레스 (workflows.peakly.art)

**Files:**
- Create: `Ansible/manifests/apps/argo-workflows-ingress.yaml`

- [ ] **Step 1: 인그레스 작성** (ingress-studio 패턴 + backend-protocol HTTP)

`Ansible/manifests/apps/argo-workflows-ingress.yaml`:

```yaml
# Argo Workflows UI — basic auth(스튜디오와 동일 자격) + cert-manager TLS.
# 주의: nginx auth-secret은 인그레스와 같은 ns(argo)에 있어야 함(Task 5에서 생성).
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: argo-workflows
  namespace: argo
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: 'true'
    nginx.ingress.kubernetes.io/backend-protocol: 'HTTP'
    nginx.ingress.kubernetes.io/auth-type: basic
    nginx.ingress.kubernetes.io/auth-secret: supabase-dashboard-basic
    nginx.ingress.kubernetes.io/auth-realm: 'Argo Workflows'
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - workflows.peakly.art
      secretName: argo-workflows-tls
  rules:
    - host: workflows.peakly.art
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: argo-workflows-server
                port:
                  number: 2746
```

- [ ] **Step 2: YAML 유효성 확인**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
python3 -c "import yaml; list(yaml.safe_load_all(open('Ansible/manifests/apps/argo-workflows-ingress.yaml'))); print('YAML OK')"
```
Expected: `YAML OK`

- [ ] **Step 3: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/manifests/apps/argo-workflows-ingress.yaml
git commit -m "feat(infra): Argo Workflows UI 인그레스(workflows.peakly.art, basic auth)"
```

---

## Task 4: 매니페스트 push (ArgoCD가 보게)

**Files:** (없음)

- [ ] **Step 1: main 반영**

`infra-manifests`·새 `argo-workflows` 앱은 git `main`을 추적하므로, Task1~3 커밋이 origin에 있어야 ArgoCD가 본다. 브랜치 머지 + push는 마무리 단계(finishing-a-development-branch)에서 수행한다. (이 Task는 머지/푸시 완료를 확인하는 체크포인트 — 실제 머지는 마지막에.)

---

## Task 5: 클러스터 적용 + 검증 (운영 핸드오프 — 사용자 실행)

**Files:** (없음 — kubectl/argo/DNS)

- [ ] **Step 1: `argo` ns에 basic-auth 시크릿 복제** (nginx는 ns별 시크릿 요구)

```bash
kubectl create namespace argo --dry-run=client -o yaml | kubectl apply -f -
kubectl get secret supabase-dashboard-basic -n data -o yaml \
  | grep -v '^\s*namespace:' | grep -v 'resourceVersion:' | grep -v 'uid:' \
  | kubectl apply -n argo -f -
```
Expected: `secret/supabase-dashboard-basic created` (argo ns). (data ns에 그 시크릿이 있다는 전제 — 없으면 ai ns 것 사용.)

- [ ] **Step 2: DNS 레코드**

`workflows.peakly.art` A레코드를 클러스터 인그레스 IP로(기존 *.peakly.art와 동일). cert-manager가 TLS 발급.

- [ ] **Step 3: ArgoCD Application 등록**

```bash
git pull   # main 최신
kubectl apply -f Ansible/manifests/argocd/argocd-app-argo-workflows.yaml
kubectl get application argo-workflows -n argocd
```
Expected: Application 생성, 잠시 후 Synced/Healthy. (infra-manifests 앱은 자동으로 rbac/ingress를 sync.)

- [ ] **Step 4: 설치 확인**

```bash
kubectl get pods -n argo
kubectl get ingress -n argo
```
Expected: `argo-workflows-server`, `argo-workflows-workflow-controller` Running; 인그레스 `workflows.peakly.art`.

- [ ] **Step 5: UI 접속**

브라우저 `https://workflows.peakly.art` → basic auth(스튜디오와 동일 계정) → Argo Workflows UI 로드.

- [ ] **Step 6: hello-world 워크플로 (ai ns, argo-workflow SA)**

```bash
argo submit -n ai --serviceaccount argo-workflow --watch - <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: hello-
spec:
  entrypoint: main
  templates:
    - name: main
      container:
        image: busybox
        command: [echo]
        args: ["argo on ai ok"]
EOF
```
Expected: 워크플로가 `Succeeded`. (argo CLI 없으면 UI에서 동일 YAML 제출.) 실패 시:
- `pods is forbidden` → Task 2 RBAC 미적용(infra-manifests sync 확인).
- 컨트롤러가 ai를 안 봄 → `singleNamespace: false` 적용 확인.

---

## Self-Review 메모

- **Spec 커버리지:** 설치(helm ArgoCD app, T1) / 클러스터 범위(values singleNamespace=false, T1) / ai RBAC(T2) / UI 인그레스 basic auth(T3) / argo ns 시크릿 복제(T5 S1) / DNS(T5 S2) / 검증 hello-world(T5 S6). 아티팩트 미사용(values에 미설정).
- **이름 일관성:** 서비스 `argo-workflows-server:2746`(차트 release명=app명 `argo-workflows`), SA `argo-workflow`(ai), 시크릿 `supabase-dashboard-basic`, TLS `argo-workflows-tls`, 호스트 `workflows.peakly.art` — spec과 일치.
- **Placeholder:** `targetRevision`만 Step 1 helm search로 확정(외부·시변값, 구체적 명령 제공). 그 외 없음.
- **주의:** values 키(`singleNamespace`, `server.authModes`, `server.extraArgs`)는 차트 버전에 따라 다를 수 있어, Step 1에서 확인한 버전의 `helm show values argo/argo-workflows --version <V>`로 키 존재 확인 권장. 실제 Sync/UI/워크플로 검증은 T5(사용자).
