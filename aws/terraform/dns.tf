# ── 앱 도메인 failover 레코드 (primary 카카오 / secondary AWS ALB) ──
# data.peakly.art는 secondary 대상(AWS PostgREST)이 생기는 Step 5에서 추가한다.
#
# ⚠️ 적용 전: 도메인 마이그레이션 때 수동 생성한 simple A 레코드
#    (peakly.art, www.peakly.art → 210.109.83.10)를 Route53에서 먼저 삭제할 것.
#    같은 이름/타입에 simple + failover 레코드는 공존 불가. (data.peakly.art는 그대로 둠)

locals {
  app_hosts = toset([var.domain_name, "www.${var.domain_name}"])
}

# Primary — 카카오 오리진(IP), 헬스체크 연동
resource "aws_route53_record" "app_primary" {
  for_each = local.app_hosts

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value
  type    = "A"
  ttl     = 60 # failover 빠르게
  records = [var.kakao_ip]

  set_identifier = "primary-kakao"
  failover_routing_policy {
    type = "PRIMARY"
  }
  health_check_id = aws_route53_health_check.kakao.id
}

# Secondary — AWS ALB(alias). 카카오 헬스체크 실패 시 이쪽으로.
resource "aws_route53_record" "app_secondary" {
  for_each = local.app_hosts

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value
  type    = "A"

  set_identifier = "secondary-aws"
  failover_routing_policy {
    type = "SECONDARY"
  }

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}
