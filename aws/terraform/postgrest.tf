# ── data.peakly.art → PostgREST (DB EC2) ────────────────────────────
# ALB HTTPS 리스너에 host 기반 규칙 추가: data.peakly.art는 PostgREST로,
# 나머지(peakly.art/www)는 기존 default(frontend TG)로.
# PostgREST는 항상 켜진 DB EC2에서 동작 → 콜드 ASG와 무관하게 data 경로 제공.

resource "aws_lb_target_group" "postgrest" {
  name        = "${var.project}-pgrst-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path                = "/"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.project}-pgrst-tg" }
}

# 고정 DB EC2를 TG에 등록 (항상 1대)
resource "aws_lb_target_group_attachment" "postgrest" {
  target_group_arn = aws_lb_target_group.postgrest.arn
  target_id        = aws_instance.db.id
  port             = 3000
}

# host = data.peakly.art → PostgREST TG
resource "aws_lb_listener_rule" "data" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.postgrest.arn
  }

  condition {
    host_header {
      values = ["data.${var.domain_name}"]
    }
  }
}
