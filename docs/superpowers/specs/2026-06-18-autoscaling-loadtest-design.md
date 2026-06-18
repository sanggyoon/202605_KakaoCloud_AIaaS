# FE·BE 자동확장(HPA) + 부하 검증 설계

작성일: 2026-06-18
상태: 설계 승인됨

## 목적

FE·BE에 **파드 자동확장(HPA)** 을 도입하고, **새 KakaoCloud VPC의 부하 생성 VM**에서
점진 램프 부하를 줘서 다음을 측정한다:
1. 부하가 오르면 **파드가 실제로 자동 증가**하는가(HPA 동작).
2. 각 부하 단계의 **응답속도(p50/p95/p99)·에러율**.
3. 자동확장 이후의 **새 한계(천장)** — 노드 용량 또는 DB(vm4) 중 무엇이 먼저 막히는가.

처음 진행하는 부하 테스트라 안전(읽기 위주·점진 램프·자동중단)을 우선한다.

## 배경 / 확정 사실

- 인프라: KakaoCloud VM × 5, K3s v1.30, Ansible 프로비저닝, ArgoCD(GitOps)+Kustomize.
  모니터링: Prometheus + Grafana + Loki + Promtail (`grafana.peakly.art`).
- 공개 도메인 `peakly.art`(FE). FE 대시보드는 **브라우저에서 직접 Supabase
  (`data.peakly.art`=vm4) PostgREST로 영화 목록을 조회**(client-side fetch).
- FE Deployment(`Ansible/manifests/4k-fe/deployment.yaml`): replicas 2,
  requests cpu 100m/mem 256Mi, limits cpu 500m/mem 512Mi, nodeSelector workload=app.
- BE Deployment(`Ansible/manifests/4k-be/deployment.yaml`): replicas 1,
  requests cpu 100m/mem 128Mi, limits cpu 300m/mem 256Mi. FastAPI(uvicorn) :8000,
  서비스는 클러스터 내부(`backend.be.svc.cluster.local`)라 **외부에서 ingress로 직접 노출 안 됨**.
- **BE는 사용자 핫패스가 아님**: FE 브라우징은 FE→Supabase(브라우저 직결)라 BE를 거의 안 거침.
  외부에서 인증 없이 BE를 때릴 수 있는 유일한 공개 경로는 **방문 비콘
  `POST /api/visit`**(FE 라우트 → BE `/api/visits`). 매니저 API는 세션 보호(401).
- HPA 전제: FE·BE 모두 CPU **request**가 있어 HPA(CPU%) 적용 가능. K3s는 **metrics-server
  기본 번들**이라 지표원 존재(가동만 확인).
- KakaoCloud는 IaC(Terraform) 없음 — VM/VPC는 **콘솔 수동 생성** 후 필요 시 Ansible 설정.

## 핵심 개념 (왜 이 설정인가)

- HPA 사용률% = `현재CPU / CPU request × 100`. request와 limit 차이가 크면 %가 실제
  포화도를 반영하지 못한다. 그래서 **request를 부하 수준에 맞게 limit 가까이 올리고**
  타겟을 70%로 잡아 "70% = 실제로 70% 바쁨 + 새 파드 뜰 여유"가 되게 한다.
- DB(Supabase vm4/vm5)는 단일 VM이라 자동확장되지 않음 → 파드가 늘어도 **DB가 최종
  천장**일 수 있음. 이번 테스트는 그걸 *측정으로 확인*만 한다(해결은 범위 밖).

## 결정 사항

| | request → | limit | HPA |
|---|---|---|---|
| FE | 100m → **300m** | 500m(유지) | min 2 / max 8 / 목표 CPU **70%** |
| BE | 100m → **200m** | 300m(유지) | min 1 / max 4 / 목표 CPU **70%** |

- 부하 도구: **k6**(단일 바이너리, JS 스크립트, 요약 리포트, Prometheus 푸시 가능).
- 부하 생성기: **KakaoCloud 새 VPC + VM 1대(2 vCPU / 4 GB)**, 공인 IP. 콘솔 수동.
- 부하 경로(사용자 흉내): FE 페이지 + Supabase 조회 + `/api/visit`(→BE).

## 상세 설계

### Part A — 자동확장(HPA) *(Ansible 매니페스트 → ArgoCD)*

1. **metrics-server 가동 확인**: `kubectl top nodes`/`top pods`가 값을 반환하는지.
   안 되면 K3s metrics-server 활성화. (HPA의 CPU 지표원.)
2. **FE/BE Deployment의 CPU request 상향**: FE 100m→300m, BE 100m→200m
   (limit·memory는 유지). HPA %가 실제 포화도를 반영하게 하려는 변경.
3. **HPA 리소스 추가**(`autoscaling/v2`):
   - `Ansible/manifests/4k-fe/hpa.yaml`: target Deployment=frontend(ns fe),
     minReplicas 2, maxReplicas 8, metric Resource cpu Utilization **70%**.
   - `Ansible/manifests/4k-be/hpa.yaml`: target Deployment=backend(ns be),
     minReplicas 1, maxReplicas 4, metric Resource cpu Utilization **70%**.
   - 각 `kustomization.yaml`에 hpa.yaml 추가 → ArgoCD 동기화.
   > FE Deployment의 `replicas:` 필드는 HPA가 관리하므로 HPA가 우선권을 가진다
   > (초기값 2는 minReplicas와 일치시켜 충돌 회피).

### Part B — 부하 생성 VM (KakaoCloud 콘솔)

1. 새 **VPC**(서비스 클러스터와 분리) + 서브넷 + 공인 IP.
2. **VM 1대**(Ubuntu, 2 vCPU / 4 GB). 아웃바운드로 `peakly.art`/`data.peakly.art` 도달 확인.
3. **k6 설치**(공식 apt 저장소 또는 바이너리). `k6 version`으로 확인.

### Part C — 부하 시나리오 (k6 스크립트)

- `loadtest/peakly-rampup.js`(저장소 `loadtest/`에 보관).
- 가상 사용자(VU) 1 iteration:
  1. `GET https://peakly.art/dashboard` (FE 파드 서빙)
  2. `GET https://data.peakly.art/rest/v1/movies?select=*&limit=120&order=has_vector.desc,release_year.desc,id.desc`
     (`apikey` 헤더 = FE의 공개 anon 키, 브라우저 조회 흉내 → vm4 부하)
  3. `POST https://peakly.art/api/visit` body `{"visitor_id":"<uuid>"}` (→ BE 부하)
- **단계(stages)**: 워밍업(저부하 1~2분) → 점진 램프(VU/RPS를 여러 단계로 상승) →
  각 단계 유지 → 램프다운. 단계별로 HPA 반응과 지연을 관찰.
- **임계치(thresholds)로 자동중단**: 예) `http_req_failed` 비율 > 임계, `http_req_duration`
  p95 > 임계 시 `abortOnFail`. (서비스 보호.)
- 측정 태그: 요청별로 FE/Supabase/BE 구분 태그를 달아 경로별 지연을 분리 측정.

### Part D — 측정 / 리포트

- **k6(클라이언트 측)**: 단계별 RPS, p50/p95/p99, 에러율, 경로별(FE/DB/BE) 지연.
- **Grafana(서버 측)**: HPA 동작 = **FE·BE 파드 수 시계열**(kube-state-metrics),
  파드/노드 **CPU·메모리**, vm4/vm5 부하(스크랩되는 범위), Loki에서 과부하 에러 로그.
- **리포트**(`loadtest/REPORT.md`): "X RPS에서 FE 2→N 확장, p95 Y, 결국 vm4 CPU가
  천장(또는 노드 용량)" 형태의 결론 + 그래프 캡처.

### 안전

- 읽기 위주(쓰기는 `/api/visit`의 visit 행뿐 → 테스트 후 `visits` 정리/무시).
- 한산한 시간대, 점진 램프, 임계치 자동중단, Grafana 실시간 관찰.
- 한계까지 밀면 `peakly.art`가 일시 느려질 수 있음(내 데모 서비스, 실사용자 거의 없음 가정).
- 롤백: 부하 중단 → HPA가 자동 축소. HPA 자체를 빼려면 hpa.yaml 제거 후 동기화.

## 범위 밖 (YAGNI)

- 노드(VM) 자동확장(클러스터 오토스케일러) — 자가관리 K3s/KakaoCloud라 난이도·범위 큼.
- DB 스케일링(read replica/pooling) — 천장 여부만 측정.
- 부하 도구의 분산(여러 부하 VM) — 단일 VM으로 충분한지 먼저 확인 후 필요 시 후속.
- 브라우저 렌더링 기반 부하(k6 browser/Playwright) — 용량 측정엔 HTTP 레벨로 충분.
