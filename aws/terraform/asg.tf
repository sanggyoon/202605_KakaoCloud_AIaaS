# ── 앱 Auto Scaling Group (콜드: 평상시 0대) ────────────────────────
resource "aws_autoscaling_group" "app" {
  name_prefix      = "${var.project}-app-"
  min_size         = var.asg_min
  max_size         = var.asg_max
  desired_capacity = var.asg_desired

  # 2개 private 서브넷에 분산 (DR 발동 시 AZ 분산)
  vpc_zone_identifier = aws_subnet.private[*].id

  # ALB 타깃 그룹에 자동 등록 + ELB 헬스체크로 불량 인스턴스 교체
  target_group_arns         = [aws_lb_target_group.app.arn]
  health_check_type         = "ELB"
  health_check_grace_period = var.health_check_grace_period # 콜드 부팅(설치+pull) 여유

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${var.project}-app"
    propagate_at_launch = true
  }

  # ⚠️ 3d-3의 DR Lambda가 desired_capacity를 0↔N으로 동적 조정한다.
  #    Terraform이 매 apply마다 0으로 되돌리면 진행 중인 failover가 꺼지므로 무시한다.
  lifecycle {
    ignore_changes = [desired_capacity]
  }
}
