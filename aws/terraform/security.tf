# ── ALB 보안그룹 — 인터넷에서 80/443 ────────────────────────────────
resource "aws_security_group" "alb" {
  name_prefix = "${var.project}-alb-"
  description = "ALB: allow 80/443 from internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags       = { Name = "${var.project}-alb-sg" }
  lifecycle { create_before_destroy = true }
}

# ── 앱(EC2/ASG) 보안그룹 — ALB에서 3000, bastion에서 22만 ───────────
resource "aws_security_group" "app" {
  name_prefix = "${var.project}-app-"
  description = "App: 3000 from ALB, 22 from bastion only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "frontend from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    description     = "SSH from bastion"
    from_port       = 22
    to_port         = 22
    protocol        = "tcp"
    security_groups = [aws_security_group.bastion.id]
  }
  egress {
    description = "all outbound (GHCR pull, TMDB, Supabase, SSM)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags       = { Name = "${var.project}-app-sg" }
  lifecycle { create_before_destroy = true }
}

# ── Bastion 보안그룹 — 관리자 IP에서만 22 ──────────────────────────
resource "aws_security_group" "bastion" {
  name_prefix = "${var.project}-bastion-"
  description = "Bastion: SSH from admin CIDRs only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "SSH from admin"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.admin_cidrs
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags       = { Name = "${var.project}-bastion-sg" }
  lifecycle { create_before_destroy = true }
}
