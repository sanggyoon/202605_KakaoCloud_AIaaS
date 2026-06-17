# understand.peakly.art 대시보드 퍼블리싱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** understand-anything 지식 그래프 대시보드를 정적(demo) 빌드해 nginx 이미지로 패키징하고, 기존 4k-fe GitOps 패턴(GitHub Actions → ghcr → ArgoCD → ingress-nginx + cert-manager)으로 `https://understand.peakly.art`에 공개 배포한다.

**Architecture:** 플러그인 대시보드 SPA를 로컬에서 demo 모드로 정적 빌드(`base=/`, 그래프 URL 루트 주입) → 그래프 JSON과 함께 `understand-dashboard/dist/`를 레포에 커밋 → CI가 `nginx:alpine` 이미지로 빌드/푸시 + kustomization 태그 갱신 → ArgoCD가 신규 네임스페이스 `understand`에 동기화. 완전 공개, 소스 미리보기는 정적 빌드라 자동 비활성.

**Tech Stack:** Vite(plugin SPA), nginx:alpine, Docker, Kustomize, ArgoCD, ingress-nginx, cert-manager, GitHub Actions.

**선행 스펙:** `docs/superpowers/specs/2026-06-17-understand-dashboard-publishing-design.md`

**경로/규칙:** git 루트 = `/Users/sanggyoon/Documents/KakaoCloud_Project`. 현재 브랜치 `feat/understand-dashboard-publish`. 커밋은 git 루트에서. 커밋 메시지 끝:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
**테스트 정책:** 단위 테스트 러너 없음 → 각 산출물은 빌드/스모크 검증으로 확인한다.

---

## File Structure

신규:
```
understand-dashboard/
  build.sh              # 로컬 재현 빌드 헬퍼 (플러그인 vite → dist 출력 + 그래프 JSON 복사)
  Dockerfile           # nginx:alpine + COPY dist + nginx.conf
  nginx.conf           # SPA fallback + gzip
  .dockerignore        # build.sh 등 비-런타임 제외
  dist/                # 커밋되는 정적 산출물 (build.sh 결과)
Ansible/manifests/understand/
  deployment.yaml      # nginx 파드
  service.yaml         # ClusterIP 80
  ingress.yaml         # understand.peakly.art + TLS
  kustomization.yaml   # 이미지 태그 핀
Ansible/manifests/argocd/
  argocd-app-understand.yaml
.github/workflows/
  deploy-understand.yml
```

---

## Task 1: 로컬 정적 빌드 (build.sh)

**Files:**
- Create: `understand-dashboard/build.sh`

- [ ] **Step 1: build.sh 작성**

Create `understand-dashboard/build.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

REPO=/Users/sanggyoon/Documents/KakaoCloud_Project
DIST="$REPO/understand-dashboard/dist"

# 플러그인 dashboard 디렉터리 자동 탐색 (버전 디렉터리 변동 대응 — 최신 버전 사용)
PLUGIN_DASH=$(ls -d "$HOME"/.claude/plugins/cache/understand-anything/understand-anything/*/packages/dashboard 2>/dev/null | sort -V | tail -1)
if [ -z "${PLUGIN_DASH:-}" ] || [ ! -d "$PLUGIN_DASH" ]; then
  echo "ERROR: understand-anything dashboard package를 찾을 수 없습니다." >&2
  exit 1
fi
PLUGIN_ROOT="$PLUGIN_DASH/../.."

# core 의존성 빌드 보장 (대시보드가 @understand-anything/core에 의존)
( cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) )
( cd "$PLUGIN_ROOT" && pnpm --filter @understand-anything/core build )

# demo 정적 빌드: base=/ override, 그래프 URL을 루트 경로로 주입, 출력은 레포 dist로
( cd "$PLUGIN_DASH" \
  && VITE_GRAPH_URL=/knowledge-graph.json \
     VITE_META_URL=/meta.json \
     VITE_CONFIG_URL=/config.json \
     npx vite build --config vite.config.demo.ts --base=/ \
       --outDir "$DIST" --emptyOutDir )

# 그래프 스냅샷을 dist 루트에 복사 (SPA가 같은 오리진에서 fetch)
cp "$REPO/.understand-anything/knowledge-graph.json" "$DIST/"
cp "$REPO/.understand-anything/meta.json" "$DIST/"
cp "$REPO/.understand-anything/config.json" "$DIST/"

echo "Built → $DIST"
```

- [ ] **Step 2: 실행 권한 부여 + 빌드 실행**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
chmod +x understand-dashboard/build.sh
./understand-dashboard/build.sh
```
Expected: 마지막 줄 `Built → .../understand-dashboard/dist`. 빌드 에러 없이 종료(exit 0).

- [ ] **Step 3: dist 산출물 검증**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/understand-dashboard
ls dist/index.html dist/knowledge-graph.json dist/meta.json dist/config.json && \
ls dist/assets/*.js >/dev/null && echo "ASSETS_OK" && \
grep -rl "knowledge-graph.json" dist/assets/*.js >/dev/null && echo "GRAPH_URL_INJECTED"
```
Expected: 네 파일 모두 존재 + `ASSETS_OK` + `GRAPH_URL_INJECTED`.
(만약 `GRAPH_URL_INJECTED`가 안 뜨면 `VITE_GRAPH_URL` 주입 실패 → build.sh의 env 변수 위치 재확인.)

- [ ] **Step 4: 로컬 스모크 (정적 서빙)**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/understand-dashboard/dist
( python3 -m http.server 8099 >/dev/null 2>&1 & echo $! > /tmp/ua_serve.pid )
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8099/ && \
curl -s http://127.0.0.1:8099/knowledge-graph.json | head -c 60 && echo
kill "$(cat /tmp/ua_serve.pid)" 2>/dev/null || true
```
Expected: `200` + `{ "project": { "name": "4K Cinema (Peakly)"` 로 시작하는 JSON 일부.

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add understand-dashboard/build.sh understand-dashboard/dist
git commit -m "feat(understand): 대시보드 정적 빌드 스크립트 + dist 산출물

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 컨테이너 패키징 (nginx)

**Files:**
- Create: `understand-dashboard/nginx.conf`
- Create: `understand-dashboard/Dockerfile`
- Create: `understand-dashboard/.dockerignore`

- [ ] **Step 1: nginx.conf 작성**

Create `understand-dashboard/nginx.conf`:
```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    # 정적 자산은 길게 캐시 (파일명 해시 기반)
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # 그래프 JSON은 캐시 짧게 (스냅샷 갱신 반영)
    location ~* \.json$ {
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }

    # SPA 라우팅 fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Dockerfile 작성**

Create `understand-dashboard/Dockerfile`:
```dockerfile
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 3: .dockerignore 작성**

Create `understand-dashboard/.dockerignore`:
```
build.sh
Dockerfile
.dockerignore
```

- [ ] **Step 4: 로컬 도커 빌드 + 컨테이너 스모크**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project/understand-dashboard
docker build -t understand-dashboard:smoke .
docker run -d --rm -p 8098:80 --name ua_smoke understand-dashboard:smoke
sleep 1
curl -s -o /dev/null -w "root=%{http_code}\n" http://127.0.0.1:8098/
curl -s -o /dev/null -w "graph=%{http_code}\n" http://127.0.0.1:8098/knowledge-graph.json
curl -s -o /dev/null -w "spa_fallback=%{http_code}\n" http://127.0.0.1:8098/some/client/route
docker stop ua_smoke
```
Expected: `root=200`, `graph=200`, `spa_fallback=200` (fallback이 index.html 반환).
(도커 미설치 환경이면 이 스텝은 배포 후 클러스터 검증으로 대체 — 그 경우 건너뛰고 다음 스텝 진행.)

- [ ] **Step 5: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add understand-dashboard/nginx.conf understand-dashboard/Dockerfile understand-dashboard/.dockerignore
git commit -m "feat(understand): nginx 정적 서빙 컨테이너 (SPA fallback + gzip)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: K8s 매니페스트

**Files:**
- Create: `Ansible/manifests/understand/deployment.yaml`
- Create: `Ansible/manifests/understand/service.yaml`
- Create: `Ansible/manifests/understand/ingress.yaml`
- Create: `Ansible/manifests/understand/kustomization.yaml`

- [ ] **Step 1: deployment.yaml 작성**

Create `Ansible/manifests/understand/deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: understand-dashboard
  namespace: understand
spec:
  replicas: 1
  selector:
    matchLabels:
      app: understand-dashboard
  template:
    metadata:
      labels:
        app: understand-dashboard
    spec:
      nodeSelector:
        workload: app
      containers:
        - name: understand-dashboard
          image: ghcr.io/sanggyoon/understand-dashboard:latest
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests:
              cpu: 25m
              memory: 32Mi
            limits:
              cpu: 200m
              memory: 128Mi
```

- [ ] **Step 2: service.yaml 작성**

Create `Ansible/manifests/understand/service.yaml`:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: understand-dashboard
  namespace: understand
spec:
  selector:
    app: understand-dashboard
  ports:
    - port: 80
      targetPort: 80
```

- [ ] **Step 3: ingress.yaml 작성**

Create `Ansible/manifests/understand/ingress.yaml`:
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: understand-dashboard
  namespace: understand
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: 'true'
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - understand.peakly.art
      secretName: understand-tls
  rules:
    - host: understand.peakly.art
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: understand-dashboard
                port:
                  number: 80
```

- [ ] **Step 4: kustomization.yaml 작성**

Create `Ansible/manifests/understand/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: understand

resources:
  - deployment.yaml
  - service.yaml
  - ingress.yaml

images:
  - name: ghcr.io/sanggyoon/understand-dashboard
    newTag: "latest"
```
(초기 `newTag: "latest"` — 워크플로(Task 4)가 첫 푸시 후 short SHA로 교체한다. `:latest`도 CI가 함께 푸시하므로 첫 sync도 동작.)

- [ ] **Step 5: kustomize 빌드 검증**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
kubectl kustomize Ansible/manifests/understand | grep -E "kind:|namespace:|image:|host:" | head -20
```
Expected: Deployment/Service/Ingress 3종, `namespace: understand`, `image: ghcr.io/sanggyoon/understand-dashboard:latest`, `host: understand.peakly.art`가 보임.
(`kubectl` 미설치 시: `command -v kustomize && kustomize build Ansible/manifests/understand`로 대체. 둘 다 없으면 YAML 들여쓰기 육안 검증 후 진행.)

- [ ] **Step 6: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/manifests/understand
git commit -m "feat(understand): k8s 매니페스트 (deployment/service/ingress/kustomization)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: ArgoCD 앱 + GitHub Actions 워크플로

**Files:**
- Create: `Ansible/manifests/argocd/argocd-app-understand.yaml`
- Create: `.github/workflows/deploy-understand.yml`

- [ ] **Step 1: argocd-app-understand.yaml 작성**

Create `Ansible/manifests/argocd/argocd-app-understand.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: understand-dashboard
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/sanggyoon/202605_KakaoCloud_AIaaS.git
    targetRevision: main
    path: Ansible/manifests/understand
  destination:
    server: https://kubernetes.default.svc
    namespace: understand
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

- [ ] **Step 2: deploy-understand.yml 작성**

Create `.github/workflows/deploy-understand.yml`:
```yaml
name: Deploy Understand Dashboard

on:
  push:
    branches:
      - main
    paths:
      - 'understand-dashboard/**'
      - '.github/workflows/deploy-understand.yml'

env:
  IMAGE: ghcr.io/sanggyoon/understand-dashboard

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # kustomization.yaml 커밋 push
      packages: write   # GHCR 이미지 push

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Extract short SHA
        id: vars
        run: echo "sha=$(echo ${{ github.sha }} | cut -c1-7)" >> $GITHUB_OUTPUT

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: ./understand-dashboard
          push: true
          tags: |
            ${{ env.IMAGE }}:${{ steps.vars.outputs.sha }}
            ${{ env.IMAGE }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Update image tag in kustomization.yaml
        run: |
          sed -i 's|newTag:.*|newTag: "${{ steps.vars.outputs.sha }}"|' \
            Ansible/manifests/understand/kustomization.yaml

      - name: Commit and push manifest update
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add Ansible/manifests/understand/kustomization.yaml
          git commit -m "ci: update understand-dashboard image → ${{ steps.vars.outputs.sha }} [skip ci]"
          git pull --rebase
          git push
```

- [ ] **Step 3: YAML 문법 검증**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['Ansible/manifests/argocd/argocd-app-understand.yaml','.github/workflows/deploy-understand.yml']]; print('YAML_OK')"
```
Expected: `YAML_OK` (파싱 에러 없음).

- [ ] **Step 4: 커밋**

```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
git add Ansible/manifests/argocd/argocd-app-understand.yaml .github/workflows/deploy-understand.yml
git commit -m "feat(understand): ArgoCD 앱 + GitHub Actions 배포 워크플로

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 마무리 + 배포 안내

- [ ] **Step 1: 전체 재빌드 정합성 확인**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
./understand-dashboard/build.sh >/dev/null && \
git status --porcelain understand-dashboard/dist | head
```
Expected: 빌드 성공. dist에 변경이 없으면 출력 없음(이미 커밋된 산출물과 동일). 변경이 있으면 `git add understand-dashboard/dist && git commit`으로 반영.

- [ ] **Step 2: finishing-a-development-branch**

REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch.
(테스트 러너가 없으므로 "테스트 통과" 게이트는 Task 1~4의 빌드/스모크 검증 통과로 갈음한다. 옵션 2 "Push and create a Pull Request" 또는 옵션 1 "Merge to main" 중 사용자 선택. main 병합/푸시 시점에 CI가 트리거되어 이미지 빌드·배포가 시작된다.)

- [ ] **Step 3: 배포 후 수동 작업 안내 (사용자에게 전달)**

병합/푸시 이후 다음은 클러스터/외부에서 처리해야 한다(코드 변경 아님):

1. **DNS** — `understand.peakly.art`의 A/CNAME를 기존 ingress LoadBalancer로 향하게 추가(다른 `*.peakly.art`와 동일 타깃). *유일한 비-GitOps 외부 작업.*
2. **ArgoCD 앱 등록(최초 1회)** — app-of-apps가 자동 인식하지 않으면:
   ```bash
   kubectl apply -f Ansible/manifests/argocd/argocd-app-understand.yaml
   ```
3. **배포 검증:**
   ```bash
   kubectl get pods,svc,ingress,certificate -n understand
   curl -I https://understand.peakly.art
   curl -s https://understand.peakly.art/knowledge-graph.json | head -c 60
   ```
   Expected: 파드 Running, certificate Ready(수 분 소요 가능), `curl -I` → `200` + 유효 TLS, JSON 응답.

- [ ] **Step 4: 갱신 절차 문서화 확인**

향후 그래프 갱신은: `/understand` 재실행 → `./understand-dashboard/build.sh` → `git add understand-dashboard/dist && git commit && push` → (이후 자동: CI 이미지 빌드 → ArgoCD 배포). 이 절차가 스펙 문서 8/4절과 일치하는지 확인하고 마무리.

---

## Self-Review 메모

- **스펙 커버리지:** 정적 빌드(Task 1) / 컨테이너(Task 2) / 매니페스트(Task 3) / ArgoCD+CI(Task 4) / 마무리+DNS·검증(Task 5). 스펙 4절 파일 구조 전부 매핑됨. 단 스펙이 언급한 `namespace.yaml`은 4k-fe 패턴(`CreateNamespace=true`)을 따라 의도적으로 생략 — Task 3 Step 4 주석과 Task 4 ArgoCD `CreateNamespace=true`로 대체.
- **이미지/레지스트리:** `ghcr.io/sanggyoon/understand-dashboard` — 기존 `ghcr.io/sanggyoon/4k-fe` 네이밍과 일치.
- **데이터 흐름:** `VITE_GRAPH_URL=/knowledge-graph.json` 주입 + dist에 JSON 복사 → 같은 오리진 fetch. nginx `try_files`로 SPA fallback. (`VITE_DOMAIN_GRAPH_URL`/`VITE_DIFF_OVERLAY_URL` 미설정 → graceful 비활성, 스펙 9절 YAGNI와 일치.)
- **placeholder 스캔:** 모든 코드 스텝에 실제 내용 포함, TBD/TODO 없음.
- **일관성:** 라벨/셀렉터 `app: understand-dashboard`, 네임스페이스 `understand`, Service port 80 → targetPort 80(nginx) 전 Task 일치. 초기 `newTag: "latest"` ↔ 워크플로 sed 갱신 정합.
- **첫 배포 순서:** manifests 변경은 워크플로 paths 필터(`understand-dashboard/**`)에 없지만, dist 커밋이 같은 푸시에 포함되어 CI가 트리거되고 태그를 SHA로 교체한다. 교체 전이라도 `:latest`로 sync 가능.
