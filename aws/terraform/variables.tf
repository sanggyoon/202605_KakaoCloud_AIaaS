variable "region" {
  description = "AWS 리전 — 카카오(한국)와 가까운 서울로 기본 설정 (복제 지연 최소화)"
  type        = string
  default     = "ap-northeast-2"
}

variable "project" {
  description = "리소스 이름/태그 prefix"
  type        = string
  default     = "peakly"
}

variable "vpc_cidr" {
  description = <<-EOT
    AWS VPC CIDR. 카카오클라우드(10.1.0.0/16)와 절대 겹치면 안 된다
    — Step 5의 site-to-site VPN에서 라우팅 충돌이 나기 때문.
  EOT
  type        = string
  default     = "10.20.0.0/16"
}

variable "azs" {
  description = "사용할 가용영역 2개 (ALB/HA용)"
  type        = list(string)
  default     = ["ap-northeast-2a", "ap-northeast-2c"]
}

variable "public_subnet_cidrs" {
  description = "퍼블릭 서브넷 CIDR (ALB, NAT GW, bastion) — azs와 같은 순서"
  type        = list(string)
  default     = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "프라이빗 서브넷 CIDR (앱 EC2, DB 레플리카) — azs와 같은 순서"
  type        = list(string)
  default     = ["10.20.10.0/24", "10.20.11.0/24"]
}

# (NAT 게이트웨이는 비용 절감을 위해 제거됨 — 앱/DB는 public 서브넷 + 공인 IP.
#  자세한 내용: aws/COST-OPTIMIZATION.md)

variable "domain_name" {
  description = "Route53에 위임된 루트 도메인 (ACM 인증서 + failover 대상)"
  type        = string
  default     = "peakly.art"
}

variable "admin_cidrs" {
  description = <<-EOT
    Bastion SSH를 허용할 관리자 IP 대역. 보안상 본인 공인 IP/32로 좁히는 것을 강력 권장.
    예: ["1.2.3.4/32"]. 기본값(0.0.0.0/0)은 전체 개방이므로 반드시 교체할 것.
  EOT
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "instance_type" {
  description = "앱 EC2 인스턴스 타입 (FE+BE 컨테이너 동시 구동 → 4GB 권장)"
  type        = string
  default     = "t3.medium"
}

variable "ssm_prefix" {
  description = "SSM Parameter Store 경로 prefix (앱 시크릿). IAM 읽기 권한이 이 경로로 제한됨"
  type        = string
  default     = "/peakly/dr"
}

variable "compose_version" {
  description = "EC2에 설치할 docker compose 플러그인 버전"
  type        = string
  default     = "v2.29.7"
}

variable "asg_min" {
  description = "ASG 최소 인스턴스 (콜드 DR = 0)"
  type        = number
  default     = 0
}

variable "asg_desired" {
  description = "ASG 초기 desired (콜드 = 0). 이후 DR Lambda가 동적 조정(ignore_changes)"
  type        = number
  default     = 0
}

variable "asg_max" {
  description = "ASG 최대 인스턴스 (DR 시 확장 상한)"
  type        = number
  default     = 4
}

variable "health_check_grace_period" {
  description = "ELB 헬스체크 유예(초) — 콜드 부팅(docker 설치+이미지 pull+compose up) 여유"
  type        = number
  default     = 600
}

variable "kakao_ip" {
  description = "카카오 Ingress 공인 IP — Route53 헬스체크가 직접 점검할 오리진"
  type        = string
  default     = "210.109.83.10"
}

variable "asg_dr_capacity" {
  description = "DR 발동 시 Lambda가 올릴 ASG desired 수"
  type        = number
  default     = 2
}

variable "db_instance_type" {
  description = "DB 레플리카 EC2 타입 (Postgres+PostgREST). 테이블 2개라 t3.small로 충분(비용 절감)"
  type        = string
  default     = "t3.small"
}

variable "db_data_volume_size" {
  description = "Postgres 데이터용 EBS(gp3) 크기(GB)"
  type        = number
  default     = 30
}
