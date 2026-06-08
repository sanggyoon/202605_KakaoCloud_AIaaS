# AWS DR 비용 최적화 — NAT 제거 + DB 다운사이즈

DR 스택의 **상시 비용**을 줄이기 위해 적용한 두 가지 변경과 그 트레이드오프를 정리한다.
적용 결과: 상시 비용 **약 $110/월 → $49/월 (약 55%↓)**.

> 모든 금액은 서울 리전(ap-northeast-2) 온디맨드 **근사치**이며 사용량(데이터 전송 등)에 따라 달라진다.

---

## 1. 무엇을 바꿨나

| 변경 | 내용 | 효과 |
|---|---|---|
| **① DB EC2 다운사이즈** | `t3.medium → t3.small` | -$19/월 |
| **② NAT Gateway 제거** | 앱 ASG·DB EC2를 **public 서브넷 + 공인 IP**로 이동 | -$43/월(+EIP -$3.6) |

①의 근거: DB 레플리카는 **논리 복제로 테이블 2개**(`movies`, `movie_vectors`)만 받고 PostgREST도 가벼워 2GB(t3.small)로 충분.

②의 근거: NAT GW의 유일한 목적은 *private 서브넷의 아웃바운드*. 그런데 상시 켜진 인스턴스(DB EC2)와 DR 시 뜨는 앱 ASG는 **인바운드만 SG로 막으면** public 서브넷에 둬도 안전하다. NAT($43/월)는 사실상 "아웃바운드를 위해 비싼 게이트웨이를 상시 켜두는" 비용이었다.

---

## 2. 비용 비교 (월, 근사)

| 항목 | Before | After |
|---|---|---|
| NAT Gateway | ~$43 | **제거** |
| NAT용 EIP(공인 IPv4) | ~$3.6 | **제거** |
| ALB + 공인 IPv4×2 | ~$23 | ~$23 |
| DB EC2 | t3.medium ~$38 | **t3.small ~$19** |
| DB 공인 IPv4 | — | +~$3.6 |
| EBS 30GB gp3 | ~$3 | ~$3 |
| 앱 ASG(콜드) | $0 | $0 |
| **합계(상시)** | **~$110** | **~$49** |

> 앱 ASG 인스턴스는 평상시 0대라 과금 없음. DR 발동 시에만 public IP가 붙은 인스턴스가 뜬다(시간당 소액).

---

## 3. 아키텍처 변경

### Before — private 서브넷 + NAT
```
            ┌───────────── VPC 10.20.0.0/16 ─────────────┐
 인터넷 ─IGW─┤ public:  ALB,  NAT GW(EIP)                  │
            │ private: 앱 ASG, DB EC2  ──아웃바운드──▶ NAT ─┘─▶ 인터넷
            └────────────────────────────────────────────┘
```

### After — public 서브넷 직접 (NAT 없음)
```
            ┌───────────── VPC 10.20.0.0/16 ─────────────┐
 인터넷 ─IGW─┤ public:  ALB                                │
            │ public:  앱 ASG, DB EC2 (공인 IP)            │──직접 아웃바운드─▶ 인터넷
            │ private: (미사용/격리 — 향후 NAT 복원용)      │
            └────────────────────────────────────────────┘
```

- 앱 ASG: `vpc_zone_identifier = public 서브넷`, Launch Template `network_interfaces.associate_public_ip_address = true`
- DB EC2: `subnet_id = public[0]`, `associate_public_ip_address = true`
- private 서브넷은 **남겨두되 라우트 미연결**(인터넷 격리). NAT를 되살리려면 private RT(→NAT)만 복원.

---

## 4. 보안 트레이드오프 (가장 중요)

public 서브넷 + 공인 IP라도 **인바운드는 보안그룹(SG)으로 최소화**되어 직접 노출되지 않는다.

| 인스턴스 | 인바운드 허용(SG) | 인터넷에서 직접 접근? |
|---|---|---|
| 앱 ASG | `3000 ← ALB SG`, `22 ← bastion SG`(현재 bastion 없음) | ❌ (ALB 경유만) |
| DB EC2 | `3000 ← ALB SG`, `5432 ← app SG`, `51820/udp ← 카카오 IP/32` | ❌ (WireGuard만, 그것도 카카오 IP에서만) |

추가 방어:
- **SSH(22) 인터넷 오픈 없음** — 관리 접속은 **SSM Session Manager**(`aws ssm start-session`)
- **IMDSv2 강제**(`http_tokens=required`) — SSRF로 인스턴스 자격증명 탈취 완화
- 아웃바운드만 개방(GHCR pull, SSM, TMDB, WireGuard)

### 그래도 남는 리스크 (정직하게)
- **SG 오설정의 폭발 반경이 커진다.** private+NAT면 SG를 잘못 열어도 인터넷에서 인바운드가 안 닿지만, public이면 **SG 실수 = 즉시 인터넷 노출**.
  - 완화: 위 SG는 0.0.0.0/0 인바운드가 **없음**(ALB SG의 80/443만 공개, 이는 의도된 공개 진입점). `admin_cidrs`는 본인 IP/32로 좁힐 것.
- 공인 IPv4가 인스턴스마다 붙어 스캔/노출 표면이 늘어남(포트는 닫혀 있으나 존재가 보임).

> 결론: **민감 데이터가 적고 비용이 중요한 DR**에는 합리적 트레이드오프. 규제/민감도가 높아지면 NAT 복원(아래)이 정석.

---

## 5. 그대로 유지된 것
- **ALB**(HTTPS/ACM failover 타깃) — 안정적 failover를 위해 유지(제거 시 복잡도↑)
- 콜드 ASG(min=0), DR Lambda 트리거, Route53 failover, 논리복제/WireGuard 설계
- private 서브넷 정의(미사용) — 향후 NAT 복원 시 그대로 사용

---

## 6. 되돌리는 법 (NAT 복원)
보안 강화를 위해 private+NAT로 되돌리려면:
1. `network.tf`에 `aws_eip.nat` + `aws_nat_gateway.main` + private RT(→NAT) + association 복원
2. `asg.tf` `vpc_zone_identifier = aws_subnet.private[*].id`
3. `compute.tf` `network_interfaces.associate_public_ip_address = false`(또는 블록 제거 + `vpc_security_group_ids` 복원)
4. `db.tf` `subnet_id = aws_subnet.private[0].id`, `associate_public_ip_address` 제거
5. `terraform apply` → 월 ~$46 추가(NAT+EIP)

---

## 7. 더 줄일 수 있는 여지 (선택)
| 방법 | 추가 절감 | 트레이드오프 |
|---|---|---|
| DB를 **t4g.small(ARM)** | ~-$4 | AMI/이미지/WireGuard를 arm64로 |
| **ALB 제거** → 단일 Caddy 프록시 | ~-$23 | TLS/라우팅 자가관리, failover 안정성↓ |
| **단일 상시 EC2 통합**(ALB+ASG+DB) | 최대 | 콜드 ASG 포기, 단일 장애점 |
| DB EC2 **Savings Plan(1년)** | ~-40% on EC2 | 약정 |

---

## 8. 운영 메모
- 카카오 측 방화벽/SG에서 **DB EC2 공인 IP**의 WireGuard(51820/udp)를 허용해야 한다.
  - `terraform output db_public_ip` 로 확인(EIP가 아니라 인스턴스 교체 시 바뀔 수 있음 → 고정하려면 `aws_eip` + association 추가 고려).
- 데이터 전송 비용: NAT가 없으니 NAT 데이터 처리요금($0.059/GB)은 사라지지만, 인스턴스 공인 IP 아웃바운드는 표준 데이터 전송요금이 적용됨(복제 트래픽은 WireGuard로 카카오와 주고받음).
