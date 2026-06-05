output "vpc_id" {
  description = "생성된 VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "VPC CIDR (VPN 라우팅 설정 시 참조)"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "퍼블릭 서브넷 ID 목록 (ALB, bastion)"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "프라이빗 서브넷 ID 목록 (앱 EC2, DB 레플리카)"
  value       = aws_subnet.private[*].id
}

output "nat_public_ips" {
  description = "NAT 게이트웨이 공인 IP — 카카오 측 방화벽에서 이 IP를 허용(복제/접근 제어)"
  value       = aws_eip.nat[*].public_ip
}

output "alb_dns_name" {
  description = "ALB DNS 이름 — Step 4에서 Route53 failover 레코드(alias)의 대상"
  value       = aws_lb.app.dns_name
}

output "alb_zone_id" {
  description = "ALB Hosted Zone ID — Route53 alias 레코드용"
  value       = aws_lb.app.zone_id
}

output "target_group_arn" {
  description = "앱 타깃 그룹 ARN — Step 3d에서 ASG가 등록"
  value       = aws_lb_target_group.app.arn
}

output "app_security_group_id" {
  description = "앱 EC2/ASG 보안그룹 ID"
  value       = aws_security_group.app.id
}

output "asg_name" {
  description = "앱 ASG 이름 — DR Lambda가 SetDesiredCapacity 대상으로 사용"
  value       = aws_autoscaling_group.app.name
}

output "kakao_health_check_id" {
  description = "카카오 Route53 헬스체크 ID — Step 4 DNS failover 레코드가 재사용"
  value       = aws_route53_health_check.kakao.id
}

output "dr_controller_function" {
  description = "DR 컨트롤러 Lambda 이름 (로그/수동 테스트용)"
  value       = aws_lambda_function.dr_controller.function_name
}
