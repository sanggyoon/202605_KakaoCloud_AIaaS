# understand.peakly.art 대시보드 퍼블리싱 설계

**작성일:** 2026-06-17
**범위:** understand-anything 지식 그래프 대시보드를 `https://understand.peakly.art`로 공개 퍼블리싱. 그래프 생성 파이프라인(`/understand`)은 불변 — 산출된 `knowledge-graph.json`을 소비만 한다.

---

## 1. 배경 / 목표

`/understand --full`로 생성된 `.understand-anything/knowledge-graph.json`(447 nodes / 670 edges / 8 layers / 13 tour steps)을 인터랙티브 대시보드로 공개한다. URL은 `understand.peakly.art`(매니저 페이지에서 이미 링크 예약됨). 기존 `4k-fe` 배포 패턴(GitHub Actions → ghcr → ArgoCD GitOps → ingress-nginx + cert-manager)을 그대로 복제해 일관성과 추가 비용 최소화를 노린다.

### 핵심 제약 / 확정 사항
- **완전 공개** — 토큰/basic-auth/IP 제한 없음. demo 정적 빌드는 토큰 게이트가 없고, **소스코드 미리보기가 자동 비활성화**되므로 원본 코드는 노출되지 않는다. 공개되는 것은 그래프 메타데이터(파일 경로 + 각 파일/함수의 한국어 요약 + 아키텍처 레이어/투어)뿐이다.
- **로컬 빌드 → `dist/` 커밋** — 대시보드 SPA 소스는 플러그인 캐시에만 존재한다. 이를 레포에 vendor하지 않고, 로컬에서 정적(demo) 빌드한 산출물(`dist/`)만 레포에 커밋한다. CI는 그 `dist/`를 nginx 이미지로 패키징만 한다.
- **신규 네임스페이스 `understand`** — `fe`와 분리한다.
- **스냅샷 모델** — 그래프는 빌드 시점에 박제된다. 코드베이스 변경이 자동 반영되지 않는다. 갱신하려면 `/understand` 재실행 → 재빌드 → 재커밋(이후 배포는 자동).

---

## 2. 대시보드 동작 원리 (설계 근거)

플러그인 대시보드(`packages/dashboard/`)는 Vite + React SPA이며 두 빌드 모드가 있다:

| | Dev 모드 (`vite`) | Demo 정적 빌드 (`build:demo`) |
|---|---|---|
| 형태 | 라이브 Node 서버 | 정적 파일 (HTML/JS/CSS) |
| 그래프 로딩 | 서버 미들웨어가 디스크에서 토큰 게이트로 서빙 | 빌드 시 `import.meta.env.VITE_*_URL`에서 fetch |
| 소스 미리보기 | O (서버가 파일시스템 읽음) | **X — 자동 비활성** ("local dashboard server 실행 중일 때만") |
| 토큰 게이트 | O (`?token=`) | X (`DEMO_MODE` → 토큰 `__demo__`, 게이트 스킵) |

demo 모드 동작(검증된 코드 기준):
- `vite.config.demo.ts`: `base: "/demo/"` 하드코딩, `define: { "import.meta.env.VITE_DEMO_MODE": "true" }`.
- `src/App.tsx` `dataUrl()`: demo 모드면 `VITE_GRAPH_URL` / `VITE_META_URL` / `VITE_CONFIG_URL` / `VITE_DOMAIN_GRAPH_URL` / `VITE_DIFF_OVERLAY_URL` 환경변수 값을 그대로 fetch URL로 사용. 미설정 항목은 `fetch(undefined)`가 되지만 해당 fetch는 optional이라 에러가 swallow된다(domain-graph / diff-overlay는 없어도 무방).
- `src/components/CodeViewer.tsx`: `accessToken === "__demo__"`이면 소스 fetch 없이 "Source preview is available only when the local dashboard server is running" 메시지 표시.

→ 결론: 공개 정적 사이트로는 demo 빌드가 유일하게 적합하며, 부수효과로 소스 비노출이 보장된다.

---

## 3. 아키텍처

```
[수동] /understand 재실행 → .understand-anything/knowledge-graph.json (+ meta.json, config.json)
[수동] ./understand-dashboard/build.sh → understand-dashboard/dist/ 갱신 (그래프 JSON 복사 포함)
[수동] git commit understand-dashboard/ + push
  ─────────────────── 이후 자동 ───────────────────
[자동] GitHub Actions(deploy-understand.yml): understand-dashboard/** 변경 감지
        → nginx 이미지 빌드(dist COPY) → ghcr.io push
        → Ansible/manifests/understand/kustomization.yaml 이미지 태그 갱신 커밋([skip ci])
[자동] ArgoCD(argocd-app-understand) → k3s 네임스페이스 understand에 sync
        → Deployment 롤아웃 → Service → Ingress(understand.peakly.art, TLS)
```

---

## 4. 컴포넌트 / 파일 구조

### 신규 디렉터리: `understand-dashboard/`
| 파일 | 책임 |
|---|---|
| `dist/` | 커밋되는 정적 빌드 산출물 (`index.html`, `assets/`, `knowledge-graph.json`, `meta.json`, `config.json`) |
| `build.sh` | 재현 가능한 로컬 빌드 헬퍼 (아래 5절) |
| `Dockerfile` | `nginx:alpine` + `COPY dist /usr/share/nginx/html` + `COPY nginx.conf` |
| `nginx.conf` | SPA fallback(`try_files $uri /index.html`), gzip, `/*.json`은 그대로 서빙 |
| `.dockerignore` | 빌드 컨텍스트 최소화 |

### `Ansible/manifests/understand/` (4k-fe 매니페스트 복제)
| 파일 | 내용 |
|---|---|
| `namespace.yaml` | `Namespace: understand` |
| `deployment.yaml` | nginx 파드 replicas 1, 컨테이너 이미지 `ghcr.io/sanggyoon/understand-dashboard:<tag>`, 포트 80, 작은 리소스 requests/limits |
| `service.yaml` | ClusterIP, port 80 → targetPort 80, selector `app=understand-dashboard` |
| `ingress.yaml` | `ingressClassName: nginx`, annotation `cert-manager.io/cluster-issuer: letsencrypt-prod`, host `understand.peakly.art`, TLS secret `understand-tls`, backend → service |
| `kustomization.yaml` | `resources:` 4개 + `images:` 태그 핀 (CI가 갱신) |

### `Ansible/manifests/argocd/argocd-app-understand.yaml`
`4k-fe` ArgoCD Application과 동일 패턴: single-source, `path: Ansible/manifests/understand`, `destination.namespace: understand`, `syncPolicy.automated`(prune + selfHeal), `CreateNamespace=true`.

### `.github/workflows/deploy-understand.yml`
`deploy-4k-fe.yml` 패턴 복제, 단 트리거를 경로 필터링:
```yaml
on:
  push:
    branches: [main]
    paths: ['understand-dashboard/**']
```
잡: ghcr 로그인 → `docker build understand-dashboard/` → 태그(커밋 SHA) push → `kustomize edit set image` 또는 `sed`로 `Ansible/manifests/understand/kustomization.yaml` 태그 갱신 → `git commit -m "ci: update understand-dashboard image → <sha> [skip ci]"` + push.

---

## 5. 빌드 처리 (build.sh 상세)

플러그인의 vite는 플러그인 디렉터리(node_modules 보유)에서 실행하되, 출력만 레포 `dist/`로 보낸다. 레포에 SPA 소스를 vendor하지 않는다.

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO=/Users/sanggyoon/Documents/KakaoCloud_Project
# 플러그인 dashboard 디렉터리 자동 탐색 (버전 디렉터리 변동 대응)
PLUGIN_DASH=$(ls -d "$HOME"/.claude/plugins/cache/understand-anything/understand-anything/*/packages/dashboard 2>/dev/null | sort -V | tail -1)
DIST="$REPO/understand-dashboard/dist"

# core 의존성 빌드 보장
( cd "$PLUGIN_DASH/../.." && pnpm install --frozen-lockfile 2>/dev/null || pnpm install ) || true
( cd "$PLUGIN_DASH/../.." && pnpm --filter @understand-anything/core build )

# demo 정적 빌드 (base=/ override, 그래프 URL을 루트 경로로 주입)
( cd "$PLUGIN_DASH" \
  && VITE_GRAPH_URL=/knowledge-graph.json \
     VITE_META_URL=/meta.json \
     VITE_CONFIG_URL=/config.json \
     npx vite build --config vite.config.demo.ts --base=/ \
       --outDir "$DIST" --emptyOutDir )

# 그래프 스냅샷을 dist 루트에 복사
cp "$REPO/.understand-anything/knowledge-graph.json" "$DIST/"
cp "$REPO/.understand-anything/meta.json" "$DIST/"
cp "$REPO/.understand-anything/config.json" "$DIST/"

echo "Built → $DIST"
```

설계 노트:
- `base=/` override로 루트 도메인 서빙(플러그인 기본 `/demo/` 무력화).
- `VITE_DOMAIN_GRAPH_URL` / `VITE_DIFF_OVERLAY_URL` 미설정 → 해당 기능(도메인 그래프, diff)은 비활성(graceful). 본 그래프/메타/컨피그만 필요.
- `build.sh`는 **로컬 개발 편의 스크립트**다. 배포 산출물의 재현성은 "커밋된 dist"가 보장하며, 플러그인 버전이 올라가도 과거 배포는 영향받지 않는다.

---

## 6. 데이터 흐름

1. 브라우저가 `https://understand.peakly.art/` 요청 → nginx가 `index.html` 서빙.
2. SPA 부팅 → `DEMO_MODE=true` → 토큰 게이트 스킵.
3. SPA가 `/knowledge-graph.json`, `/meta.json`, `/config.json`을 같은 오리진에서 fetch → nginx가 정적 JSON 서빙.
4. 그래프/레이어/투어/검색 렌더. 노드 클릭 시 소스 미리보기는 demo 안내 메시지 표시(소스 비노출).

---

## 7. 에러 / 엣지 케이스

- **SPA 라우팅 404**: nginx `try_files $uri $uri/ /index.html`로 클라이언트 라우팅 fallback.
- **그래프 JSON 누락**: `build.sh`가 cp 실패 시 `set -e`로 즉시 중단 → 빈 배포 방지.
- **TLS 발급 지연**: cert-manager가 `letsencrypt-prod`로 비동기 발급. 최초 배포 후 인증서 Ready까지 수 분 소요 가능 — `kubectl get certificate -n understand`로 확인.
- **DNS 미설정**: `understand.peakly.art` A/CNAME가 ingress LB로 향하지 않으면 접속 불가. **이건 외부 DNS에서 수동 추가해야 하는 유일한 비-GitOps 작업**(다른 `*.peakly.art`와 동일 타깃).
- **CI 무한 루프 방지**: 태그 갱신 커밋에 `[skip ci]` 부착(4k-fe와 동일).

---

## 8. 테스트 / 검증

Next.js 같은 단위 테스트 러너 없음 → 빌드/배포 스모크로 검증:
1. `build.sh` 실행 후 `dist/index.html`, `dist/assets/`, `dist/knowledge-graph.json` 존재 확인.
2. 로컬 스모크: `npx serve dist`(또는 `python -m http.server`) → 브라우저에서 그래프 로드 + 레이어 8개 + 투어 13단계 표시, 노드 클릭 시 미리보기 안내 메시지 확인.
3. 배포 후: `curl -I https://understand.peakly.art` → `200` + 유효 TLS, `curl -s https://understand.peakly.art/knowledge-graph.json | head` → JSON 응답.
4. `kubectl get pods,ingress,certificate -n understand` → Running / Ready 확인.

---

## 9. 범위 밖 (YAGNI)

- 그래프 자동 재생성(`/understand`의 무인 CI 실행) — 비용/복잡도 과다, 수동 유지.
- 도메인 그래프(`/understand-domain`) / diff 오버레이 — 미생성이므로 비활성.
- 소스코드 미리보기 — demo 빌드에서 의도적으로 비활성(보안상 바람직).
- 접근 제어(토큰/auth/IP) — 완전 공개 결정.
- git LFS / 이미지 직접 push 등 dist 누적 최적화 — 갱신 빈도 낮아 현재 불필요.
