# Peakly 부하 테스트 런북

FE·BE HPA 자동확장을 새 VPC/VM의 k6로 검증하는 절차.
**한산한 시간대에, 점진 램프 + 자동중단으로 안전하게.**

## 0. 사전조건
- HPA 매니페스트 머지 → ArgoCD 동기화 → `kubectl get hpa -A`에 frontend/backend HPA가
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
- 단계별 표: VU / RPS / p95 / 에러율 / FE·BE 파드수 / 병목.
- 결론 예: "VU 200에서 FE 2→5 확장, p95 0.8s. VU 500에서 vm4 CPU 95퍼센트로 천장,
  p95 4s·에러 8퍼센트 → 한계 ≈ 그 직전. 다음 개선: DB(읽기 replica/pooling) 또는 노드 증설."

## 8. 정리
- 부하 종료 → HPA 자동 축소(수 분 뒤 min으로). `kubectl get hpa -A`로 확인.
- 테스트로 쌓인 visit 행 정리(선택): vm4 `visits`에서 테스트 구간 row 삭제.
- 부하 VM/VPC는 보관(재실험용) 또는 콘솔에서 삭제.
