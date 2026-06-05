# ── 최신 Amazon Linux 2023 AMI (x86_64) ────────────────────────────
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# ── 앱 Launch Template (FE+BE compose 실행) ─────────────────────────
resource "aws_launch_template" "app" {
  name_prefix   = "${var.project}-app-"
  image_id      = data.aws_ssm_parameter.al2023.value
  instance_type = var.instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.app.arn
  }

  vpc_security_group_ids = [aws_security_group.app.id]

  # compose 파일을 base64로 주입 → aws/docker-compose.yml 단일 소스 유지(drift 없음)
  user_data = base64encode(templatefile("${path.module}/user_data.sh.tftpl", {
    region          = var.region
    ssm_prefix      = var.ssm_prefix
    compose_b64     = base64encode(file("${path.module}/../docker-compose.yml"))
    compose_version = var.compose_version
  }))

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2 강제
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.project}-app" }
  }

  lifecycle { create_before_destroy = true }
}
