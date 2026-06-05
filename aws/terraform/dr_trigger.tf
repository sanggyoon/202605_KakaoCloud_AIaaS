# ── Route53 헬스체크 (카카오 오리진 직접 점검) ──────────────────────
# DNS failover(Step 4)와 ASG 트리거가 공유하는 단일 신호.
# DNS가 아니라 카카오 IP를 직접 점검 → failover 레코드와 순환 의존 없음.
resource "aws_route53_health_check" "kakao" {
  ip_address        = var.kakao_ip
  fqdn              = var.domain_name # SNI + Host 헤더
  port              = 443
  type              = "HTTPS"
  resource_path     = "/"
  request_interval  = 30
  failure_threshold = 3

  tags = { Name = "${var.project}-kakao-health" }
}

# ── DR 컨트롤러 Lambda 패키징 ───────────────────────────────────────
data "archive_file" "dr_controller" {
  type        = "zip"
  source_file = "${path.module}/lambda/dr_controller.py"
  output_path = "${path.module}/build/dr_controller.zip"
}

# ── Lambda IAM ──────────────────────────────────────────────────────
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dr_lambda" {
  name_prefix        = "${var.project}-dr-lambda-"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "dr_lambda_logs" {
  role       = aws_iam_role.dr_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "dr_lambda" {
  statement {
    sid       = "ReadHealthCheck"
    actions   = ["route53:GetHealthCheckStatus"]
    resources = ["*"] # Route53 헬스체크는 리소스 레벨 제한 미지원
  }
  statement {
    sid       = "AdjustAsg"
    actions   = ["autoscaling:SetDesiredCapacity", "autoscaling:DescribeAutoScalingGroups"]
    resources = ["*"] # Describe는 *가 필요
  }
}

resource "aws_iam_role_policy" "dr_lambda" {
  name_prefix = "${var.project}-dr-lambda-"
  role        = aws_iam_role.dr_lambda.id
  policy      = data.aws_iam_policy_document.dr_lambda.json
}

# ── Lambda 함수 ─────────────────────────────────────────────────────
resource "aws_lambda_function" "dr_controller" {
  function_name    = "${var.project}-dr-controller"
  role             = aws_iam_role.dr_lambda.arn
  runtime          = "python3.12"
  handler          = "dr_controller.handler"
  filename         = data.archive_file.dr_controller.output_path
  source_code_hash = data.archive_file.dr_controller.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      HEALTH_CHECK_ID = aws_route53_health_check.kakao.id
      ASG_NAME        = aws_autoscaling_group.app.name
      DR_CAPACITY     = tostring(var.asg_dr_capacity)
    }
  }

  tags = { Name = "${var.project}-dr-controller" }
}

# ── EventBridge 스케줄(1분) → Lambda ────────────────────────────────
resource "aws_cloudwatch_event_rule" "dr_tick" {
  name_prefix         = "${var.project}-dr-tick-"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "dr_tick" {
  rule      = aws_cloudwatch_event_rule.dr_tick.name
  target_id = "dr-controller"
  arn       = aws_lambda_function.dr_controller.arn
}

resource "aws_lambda_permission" "dr_tick" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dr_controller.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.dr_tick.arn
}
