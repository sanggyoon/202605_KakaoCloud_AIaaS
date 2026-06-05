# ── DB 레플리카 고정 EC2 (pet) ──────────────────────────────────────
# Postgres(논리 구독, pgvector) + PostgREST 를 올릴 박스. ASG 아님(상태 보유).
# 소프트웨어/복제 설정은 런북(aws/DR-DB-RUNBOOK.md) 참조 — 여기선 인프라만.

resource "aws_security_group" "db" {
  name_prefix = "${var.project}-db-"
  description = "DB replica: PostgREST from ALB, WireGuard from Kakao"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgREST(3000) from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    description = "WireGuard from Kakao"
    from_port   = 51820
    to_port     = 51820
    protocol    = "udp"
    cidr_blocks = ["${var.kakao_ip}/32"]
  }
  ingress {
    description     = "Postgres(5432) from app SG (직접 접근 옵션)"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-db-sg" }
  lifecycle { create_before_destroy = true }
}

# IAM (SSM Session Manager + Param Store 읽기)
resource "aws_iam_role" "db" {
  name_prefix        = "${var.project}-db-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "db_ssm_core" {
  role       = aws_iam_role.db.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "db_ssm_read" {
  name_prefix = "${var.project}-db-ssm-"
  role        = aws_iam_role.db.id
  policy      = data.aws_iam_policy_document.ssm_read.json
}

resource "aws_iam_instance_profile" "db" {
  name_prefix = "${var.project}-db-"
  role        = aws_iam_role.db.name
}

# Postgres 데이터용 EBS (루트와 분리 → 인스턴스 교체에도 데이터 보존)
resource "aws_ebs_volume" "db_data" {
  availability_zone = var.azs[0]
  size              = var.db_data_volume_size
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${var.project}-db-data" }
}

resource "aws_instance" "db" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.db_instance_type
  subnet_id              = aws_subnet.private[0].id
  availability_zone      = var.azs[0]
  vpc_security_group_ids = [aws_security_group.db.id]
  iam_instance_profile   = aws_iam_instance_profile.db.name

  # 정적 부트스트랩(설치+마운트만) — 템플릿 변수 불필요. aws cli는 IMDS로 리전 자동 인식.
  user_data = file("${path.module}/user_data_db.sh.tftpl")

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  tags = { Name = "${var.project}-db" }
}

resource "aws_volume_attachment" "db_data" {
  device_name = "/dev/xvdf" # Nitro에선 /dev/nvme1n1로 보임 (user_data가 자동 탐지)
  volume_id   = aws_ebs_volume.db_data.id
  instance_id = aws_instance.db.id
}
