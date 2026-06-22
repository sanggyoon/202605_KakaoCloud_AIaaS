# Peakly 부하 테스트 런북

FE·BE HPA 자동확장을 새 VPC/VM의 k6로 검증하는 절차.
**한산한 시간대에, 점진 램프 + 자동중단으로 안전하게.**

## 0. 사전 검증 (실행 전 게이트 — 아래가 전부 통과해야 부하 실행)

클러스터에 접근 가능한 곳(bastion/로컬 kubeconfig)에서 순서대로 확인한다.

| # | 확인 | 명령 | 기대 출력 | 실패 시 |
|---|---|---|---|---|
| 1 | HPA 존재·타깃 | `kubectl get hpa -A` | `fe/frontend`(MINPODS 2·MAXPODS 8), `be/backend`(1·4) 행, `TARGETS`에 `N%/70%` | ArgoCD 미동기화 → `kubectl get application -n argocd`, Sync |
| 2 | **TARGETS가 `<unknown>` 아님** | `kubectl get hpa -A` | `5%/70%`처럼 **숫자/70%** | metrics-server 미동작 → #3 먼저 |
| 3 | metrics-server 동작 | `kubectl top nodes` · `kubectl top pods -n fe` · `kubectl top pods -n be` | CPU/MEM 값 반환(에러 X) | K3s metrics-server 활성화 확인 후 1~2분 대기 |
| 4 | 현재 레플리카 = min | `kubectl get deploy -n fe frontend` · `kubectl get deploy -n be backend` | frontend `2/2`, backend `1/1` | 파드 Pending이면 노드 여유(`kubectl describe`) 확인 |
| 5 | 파드 Ready | `kubectl get pods -n fe` · `kubectl get pods -n be` | 전부 `Running`·READY | 파드 로그 확인 |
| 6 | 공개 경로 도달 (부하 VM에서) | `curl -sI https://peakly.art \| head -1` · `curl -sI -H "apikey:<anon>" "https://data.peakly.art/rest/v1/movies?limit=1"` | 둘 다 `HTTP/2 200` | 보안그룹 아웃바운드 443 허용 확인 |
| 7 | Grafana 관찰 패널 위치 | `grafana.peakly.art` 접속 | FE/BE **레플리카 수**, 파드/노드 CPU, vm4 CPU 패널 위치를 미리 찾아둠 | 패널 없으면 어디서 볼지 메모 |

- `<anon>` = `4K_FE/app/lib/data.ts`의 `SUPABASE_ANON_KEY`(공개 키).
- **게이트:** 1~7이 모두 OK여야 실제 부하(4단계)로 넘어간다. 특히 #2 `<unknown>`이면 HPA가
  스케일아웃 판단을 못 하므로 테스트 의미가 없다 — 반드시 먼저 해결.

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
- `loadtest/peakly-rampup.js`를 VM으로 복사(scp 또는 git clone).
- 공개 anon 키 확인: `4K_FE/app/lib/data.ts`의 `SUPABASE_ANON_KEY` 값.
- 파싱 검증: `k6 inspect peakly-rampup.js` (stages/thresholds가 에러 없이 출력되면 OK).

## 4. 실행 (점진 램프, 자동중단)
```
SUPABASE_ANON_KEY='<공개 anon 키>' k6 run peakly-rampup.js
```
- stages의 target은 VU(동시 사용자) 기준. **처음엔 보수적으로** — 50/200/500이 과하면
  스크립트 stages의 target을 낮춰 다시. p95>3s 또는 에러율>5% 지속 시 k6가 자동 중단.

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

아래 틀을 `loadtest/REPORT.md`로 복사해 채운다.

### 해석 요령 (표를 채우기 전에)
- **RPS(처리량)**: k6 요약의 `http_reqs` ÷ 단계 지속시간 ≈ 단계별 RPS.
- **지연 p95/p99**: `http_req_duration`. 경로별은 `fe_page_ms`/`db_movies_ms`/`be_visit_ms`로
  FE 파드·vm4 DB·BE 중 **무엇이 느려졌는지** 분리한다.
- **에러%**: `http_req_failed`.
- **FE/BE 파드 수**: Grafana 레플리카 시계열에서 그 단계의 **최대값**(= HPA 스케일아웃 증거).
- **병목 판정**: 파드가 max까지 늘었는데도 p95↑·에러↑면 → 파드 위(노드 또는 DB)가 천장.
  `db_movies_ms`만 급증 + vm4 CPU/커넥션 포화면 → **vm4(DB)가 천장**.

### 단계별 결과 표
| 단계 | VU | RPS | p95 | p99 | 에러% | FE파드 | BE파드 | 병목/메모 |
|---|---|---|---|---|---|---|---|---|
| 워밍업 | 50  | | | | | 2 | 1 | |
| 1차 램프 | 200 | | | | | | | |
| 1차 유지 | 200 | | | | | | | HPA 반응 관찰 |
| 2차 램프 | 500 | | | | | | | |
| 2차 유지 | 500 | | | | | | | |

### 결론
- HPA 동작: VU __에서 FE 2→__ / BE 1→__ 로 확장 확인(또는 미확장).
- 한계(천장): VU __ 부근에서 ____ 가 포화(노드 CPU / vm4 CPU·커넥션) → p95 __s·에러 __%.
- 권장 한계 운영점 ≈ 천장 직전 단계.
- (참고 예) "VU 200에서 FE 2→5 확장, p95 0.8s. VU 500에서 vm4 CPU 95%로 천장,
  p95 4s·에러 8% → 한계 ≈ 그 직전."

### 다음 개선 (범위 밖, 후속 과제)
- DB: 읽기 replica / 커넥션 풀링(PgBouncer) / 인덱스·쿼리 튜닝.
- 노드: 워커 증설 또는 클러스터 오토스케일러.
- 캐싱: 영화 목록 응답 CDN/Edge 캐시(브라우저 직결 Supabase 조회 완화).

## 8. 정리
- 부하 종료 → HPA 자동 축소(수 분 뒤 min으로). `kubectl get hpa -A`로 확인.
- 테스트로 쌓인 visit 행 정리(선택): vm4 `visits`에서 테스트 구간 row 삭제.
- 부하 VM/VPC는 보관(재실험용) 또는 콘솔에서 삭제.
