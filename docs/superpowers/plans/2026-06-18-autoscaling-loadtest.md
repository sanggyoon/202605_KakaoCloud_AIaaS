# FE·BE 자동확장(HPA) + 부하 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FE·BE에 CPU 기반 HPA(파드 자동확장)를 도입하고, KakaoCloud 새 VPC/VM에서 k6 램프 부하로 자동확장·응답속도·한계를 측정한다.

**Architecture:** FE/BE Deployment의 CPU request를 부하 수준에 맞게 올리고 `autoscaling/v2` HPA를 추가(kustomization → ArgoCD가 자동 적용). 새 VPC의 VM에 설치한 k6가 FE 페이지 + Supabase 조회 + 방문 비콘을 점진 램프로 보내고, k6(클라이언트)와 Grafana(서버)로 측정한다.

**Tech Stack:** Kubernetes HPA(autoscaling/v2), K3s metrics-server, Kustomize, ArgoCD(GitOps), k6, KakaoCloud(콘솔), Grafana/Prometheus/Loki.

## Global Constraints

- HPA 적용 경로: 매니페스트를 main에 머지 → **ArgoCD가 ~3분 내 자동 동기화**(별도 apply 불필요). 단 머지 전 metrics-server 가동은 선행 확인.
- HPA %는 CPU **request** 기준 → request를 부하 수준에 맞게 올린다: **FE 100m→300m, BE 100m→200m**(limit·memory 유지).
- HPA 수치: **FE min2/max8/CPU70%, BE min1/max4/CPU70%**.
- Deployment에서 `replicas` 필드는 **제거**(HPA가 소유; git에 두면 ArgoCD가 HPA 스케일을 되돌릴 수 있음).
- 부하 도구 **k6**, 부하 생성기 **KakaoCloud 새 VPC + VM 1대(2 vCPU/4 GB), 콘솔 수동**.
- 부하 경로(읽기 위주): `GET peakly.art/dashboard` + `GET data.peakly.art/.../movies` + `POST peakly.art/api/visit`. visit 쓰기는 테스트 후 정리.
- 안전: 점진 램프 + 임계치 자동중단(에러율>5% 또는 p95>3s), 한산한 시간대, Grafana 실시간 관찰.
- 검증: YAML은 `ruby -ryaml`(macOS 기본)로 파싱 확인. 클러스터 반영은 ArgoCD가, 부하 실행은 사람이(런북).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 작업 브랜치: `feat/autoscaling-loadtest` (이미 생성됨).

## File Structure

- **Modify** `Ansible/manifests/4k-fe/deployment.yaml` — CPU request 300m, `replicas` 제거.
- **Modify** `Ansible/manifests/4k-be/deployment.yaml` — CPU request 200m, `replicas` 제거.
- **Create** `Ansible/manifests/4k-fe/hpa.yaml` — frontend HPA(min2/max8/70%).
- **Create** `Ansible/manifests/4k-be/hpa.yaml` — backend HPA(min1/max4/70%).
- **Modify** `Ansible/manifests/4k-fe/kustomization.yaml` / `4k-be/kustomization.yaml` — resources에 hpa.yaml 추가.
- **Create** `loadtest/peakly-rampup.js` — k6 램프 부하 스크립트.
- **Create** `loadtest/README.md` — VM 프로비저닝·k6 설치·실행·Grafana 관찰·리포트 런북.

---

### Task 1: HPA 도입 (FE·BE request 상향 + HPA 매니페스트)

**Files:**
- Modify: `Ansible/manifests/4k-fe/deployment.yaml`, `Ansible/manifests/4k-be/deployment.yaml`
- Create: `Ansible/manifests/4k-fe/hpa.yaml`, `Ansible/manifests/4k-be/hpa.yaml`
- Modify: `Ansible/manifests/4k-fe/kustomization.yaml`, `Ansible/manifests/4k-be/kustomization.yaml`

**Interfaces:**
- Consumes: 기존 Deployment(frontend@fe, backend@be), metrics-server(K3s 기본).
- Produces: HPA 리소스 2개. ArgoCD 동기화 시 FE/BE 파드가 CPU 70% 기준으로 자동확장.

- [ ] **Step 0(선행): metrics-server 가동 확인 (클러스터 접근 가능 시)**

Run: `KUBECONFIG=Ansible/kubeconfig kubectl top nodes`
Expected: 노드별 CPU/메모리 값 출력. `Metrics API not available` 나오면 K3s metrics-server
활성화 필요(보통 `kube-system`에 기본 존재). 클러스터 미접근 환경이면 이 단계는 머지 후
ArgoCD 동기화 전에 확인.

- [ ] **Step 1: FE Deployment — CPU request 상향 + replicas 제거**

`Ansible/manifests/4k-fe/deployment.yaml`에서 두 곳 수정.

(a) requests CPU 100m → 300m:
```yaml
            requests:
              cpu: 300m
              memory: 256Mi
```
(기존 `requests:\n  cpu: 100m\n  memory: 256Mi` 블록의 cpu만 변경. limits 500m/512Mi는 유지.)

(b) `replicas: 2` 라인 제거 — `spec:` 바로 아래:
```yaml
spec:
  selector:
    matchLabels:
      app: frontend
```
(기존 `spec:\n  replicas: 2\n  selector:` 에서 replicas 줄 삭제.)

- [ ] **Step 2: BE Deployment — CPU request 상향 + replicas 제거**

`Ansible/manifests/4k-be/deployment.yaml`에서:

(a) requests CPU 100m → 200m:
```yaml
            requests:
              cpu: 200m
              memory: 128Mi
```
(limits 300m/256Mi 유지.)

(b) `replicas: 1` 제거:
```yaml
spec:
  selector:
    matchLabels:
      app: backend
```

- [ ] **Step 3: FE HPA 매니페스트 작성**

`Ansible/manifests/4k-fe/hpa.yaml`:
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: frontend
  namespace: fe
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: frontend
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

- [ ] **Step 4: BE HPA 매니페스트 작성**

`Ansible/manifests/4k-be/hpa.yaml`:
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend
  namespace: be
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

- [ ] **Step 5: kustomization에 hpa.yaml 추가**

`Ansible/manifests/4k-fe/kustomization.yaml`의 resources에 추가:
```yaml
resources:
  - deployment.yaml
  - service.yaml
  - ingress.yaml
  - hpa.yaml
```
`Ansible/manifests/4k-be/kustomization.yaml`의 resources에 추가:
```yaml
resources:
  - deployment.yaml
  - service.yaml
  - backfill-cronjob.yaml
  - subtitle-cronjob.yaml
  - hpa.yaml
```

- [ ] **Step 6: YAML 유효성 검사**

Run:
```bash
cd /Users/sanggyoon/Documents/KakaoCloud_Project
for f in Ansible/manifests/4k-fe/hpa.yaml Ansible/manifests/4k-be/hpa.yaml \
         Ansible/manifests/4k-fe/deployment.yaml Ansible/manifests/4k-be/deployment.yaml \
         Ansible/manifests/4k-fe/kustomization.yaml Ansible/manifests/4k-be/kustomization.yaml; do
  ruby -ryaml -e 'YAML.load_stream(File.read(ARGV[0]))' "$f" && echo "OK $f"
done
```
Expected: 각 파일 `OK ...`. (클러스터 접근 가능하면 추가로
`KUBECONFIG=Ansible/kubeconfig kubectl apply --dry-run=client -k Ansible/manifests/4k-fe`)

- [ ] **Step 7: 커밋**

```bash
git add Ansible/manifests/4k-fe/deployment.yaml Ansible/manifests/4k-be/deployment.yaml \
        Ansible/manifests/4k-fe/hpa.yaml Ansible/manifests/4k-be/hpa.yaml \
        Ansible/manifests/4k-fe/kustomization.yaml Ansible/manifests/4k-be/kustomization.yaml
git commit -m "$(printf 'feat(infra): FE/BE HPA 자동확장 + CPU request 상향\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

> 머지 후 ArgoCD가 동기화하면 `kubectl get hpa -A`로 TARGETS(현재%/70%)·REPLICAS 확인.

---

### Task 2: k6 부하 스크립트

**Files:**
- Create: `loadtest/peakly-rampup.js`

**Interfaces:**
- Consumes: env `SUPABASE_ANON_KEY`(공개 anon 키). 대상 `peakly.art`/`data.peakly.art`.
- Produces: 램프 부하 스크립트(stages + thresholds + 경로별 Trend 지표).

- [ ] **Step 1: 스크립트 작성**

`loadtest/peakly-rampup.js`:
```javascript
// Peakly 램프 부하 — FE 페이지 + Supabase 조회 + 방문 비콘(BE).
// 실행: SUPABASE_ANON_KEY=<공개 anon 키> k6 run loadtest/peakly-rampup.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const FE = 'https://peakly.art';
const DB = 'https://data.peakly.art';
const ANON = __ENV.SUPABASE_ANON_KEY;

export const options = {
  // target = 동시 가상사용자(VU) 수. 보수적으로 시작해 단계적으로 올린다.
  stages: [
    { duration: '2m', target: 50 },   // 워밍업
    { duration: '3m', target: 200 },  // 1차 램프
    { duration: '3m', target: 200 },  // 유지(HPA 반응 관찰)
    { duration: '3m', target: 500 },  // 2차 램프
    { duration: '3m', target: 500 },  // 유지
    { duration: '2m', target: 0 },    // 램프다운
  ],
  thresholds: {
    // 에러율 5% 초과 또는 p95 3초 초과가 지속되면 테스트 자동 중단(서비스 보호).
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' }],
  },
};

const fePage = new Trend('fe_page_ms', true);
const dbQuery = new Trend('db_movies_ms', true);
const beVisit = new Trend('be_visit_ms', true);

export default function () {
  // 1) FE 페이지 (FE 파드 서빙)
  const fe = http.get(`${FE}/dashboard`, { tags: { path: 'fe_page' } });
  fePage.add(fe.timings.duration);
  check(fe, { 'fe 2xx/3xx': (r) => r.status >= 200 && r.status < 400 });

  // 2) Supabase 영화 목록 (vm4) — 브라우저 client-side fetch 흉내
  const db = http.get(
    `${DB}/rest/v1/movies?select=*&limit=120&order=has_vector.desc,release_year.desc,id.desc`,
    { headers: { apikey: ANON }, tags: { path: 'db_movies' } },
  );
  dbQuery.add(db.timings.duration);
  check(db, { 'db 200': (r) => r.status === 200 });

  // 3) 방문 비콘 (→ BE FastAPI). visit 행이 써지므로 테스트 후 정리.
  const be = http.post(`${FE}/api/visit`, JSON.stringify({ visitor_id: uuidv4() }),
    { headers: { 'Content-Type': 'application/json' }, tags: { path: 'be_visit' } });
  beVisit.add(be.timings.duration);

  sleep(1); // 사용자 think-time
}
```

- [ ] **Step 2: 스크립트 검증**

k6가 설치된 곳(로컬 또는 부하 VM)에서:
Run: `k6 inspect loadtest/peakly-rampup.js`
Expected: 옵션(stages/thresholds)이 에러 없이 출력(실행 아님, 파싱만).
> k6 미설치 로컬이면 이 검증은 Task 3에서 VM에 k6 설치 후 수행. (k6 스크립트는 ESM이라
> 일반 node 문법검사가 부적합 — k6 inspect가 올바른 검증.)

- [ ] **Step 3: 커밋**

```bash
git add loadtest/peakly-rampup.js
git commit -m "$(printf 'feat(loadtest): k6 램프 부하 스크립트(FE/DB/BE 경로)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: 부하 테스트 런북

**Files:**
- Create: `loadtest/README.md`

**Interfaces:**
- Consumes: Task 1(HPA), Task 2(k6 스크립트), KakaoCloud 콘솔, Grafana.
- Produces: VM 프로비저닝~실행~측정~리포트 절차 문서.

- [ ] **Step 1: 런북 작성**

`loadtest/README.md`:
```markdown
# Peakly 부하 테스트 런북

FE·BE HPA 자동확장을 새 VPC/VM의 k6로 검증하는 절차.
**한산한 시간대에, 점진 램프 + 자동중단으로 안전하게.**

## 0. 사전조건
- Task 1(HPA) 머지 → ArgoCD 동기화 → `kubectl get hpa -A`에 frontend/backend HPA가
  `TARGETS`(예: 5%/70%), `MINPODS/MAXPODS` 보이는지 확인.
- metrics-server 동작(`kubectl top pods -n fe`가 값 반환).

## 1. 부하 생성 VM (KakaoCloud 콘솔)
1. 새 **VPC** + 서브넷 생성(서비스 클러스터와 분리).
2. **VM 1대**: Ubuntu 22.04, 2 vCPU / 4 GB, 공인 IP 부여.
3. 보안그룹: 아웃바운드 443 허용(인바운드는 SSH만).
4. SSH 접속 후 도달 확인: `curl -sI https://peakly.art | head -1` → `HTTP/2 200`.

## 2. k6 설치 (VM)
```
sudo gpg -k && sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6
k6 version
```

## 3. 스크립트 준비
- `loadtest/peakly-rampup.js`를 VM으로 복사(scp/git).
- 공개 anon 키 확인: `4K_FE/app/lib/data.ts`의 `SUPABASE_ANON_KEY` 값.
- 파싱 검증: `k6 inspect peakly-rampup.js`.

## 4. 실행 (점진 램프, 자동중단)
```
SUPABASE_ANON_KEY='<공개 anon 키>' k6 run peakly-rampup.js
```
- stages는 VU(동시 사용자) 기준. **처음엔 보수적으로** — 50/200/500이 과하면 스크립트
  stages의 target을 낮춰 다시. p95>3s 또는 에러율>5% 지속 시 k6가 자동 중단.

## 5. 관찰 (실행 중 Grafana 동시에)
- **HPA 동작**: `kubectl get hpa -A -w` 또는 Grafana에서 FE/BE **레플리카 수 시계열**이
  부하 상승에 따라 2→N으로 느는지.
- **자원**: FE/BE 파드 CPU(%), 노드 CPU/메모리.
- **DB 천장**: vm4(data) CPU/커넥션. 파드가 늘어도 여기서 막히면 DB가 천장.
- **에러 로그**: Loki에서 5xx/타임아웃.

## 6. k6 결과 읽기 (종료 후)
- `http_reqs`/`iterations` = 처리량, `http_req_duration` p95/p99 = 지연.
- 경로별: `fe_page_ms`/`db_movies_ms`/`be_visit_ms`로 FE·DB·BE 중 어디가 느린지 분리.
- `http_req_failed` = 에러율.

## 7. 리포트 (`loadtest/REPORT.md`로 정리)
- 단계별 표: VU / RPS / p95 / 에러율 / FE·BE 파드수 / 병목.
- 결론 예: "VU 200에서 FE 2→5 확장, p95 0.8s. VU 500에서 vm4 CPU 95%로 천장,
  p95 4s·에러 8% → 한계 ≈ 그 직전. 다음 개선: DB(읽기 replica/pooling) 또는 노드 증설."

## 8. 정리
- 부하 종료 → HPA 자동 축소(수 분 뒤 min으로). `kubectl get hpa -A`로 확인.
- 테스트로 쌓인 visit 행 정리(선택): vm4 `visits`에서 테스트 구간 row 삭제.
- 부하 VM/VPC는 보관(재실험용) 또는 콘솔에서 삭제.
```

- [ ] **Step 2: 커밋**

```bash
git add loadtest/README.md
git commit -m "$(printf 'docs(loadtest): 부하 테스트 런북(프로비저닝~측정~리포트)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 완료 후

- `superpowers:finishing-a-development-branch`로 main 머지/PR 결정.
- **머지 = HPA 자동 적용**(ArgoCD GitOps). 부하 VM 프로비저닝·테스트 실행·측정은 런북대로 사람이 수행.
- 머지 후 `kubectl get hpa -A`로 HPA가 떴는지 먼저 확인하고, 한산한 시간대에 부하 테스트 진행.
- push 거부 시 `git fetch origin && git rebase origin/main` 후 재push.
