# ── 앱 EC2 IAM 역할/인스턴스 프로파일 ───────────────────────────────
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name_prefix        = "${var.project}-app-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = { Name = "${var.project}-app-role" }
}

# SSM Session Manager(SSH 없이 접속) + 기본 관리 권한
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Parameter Store 읽기 — prefix 경로로만 제한 (최소 권한)
data "aws_iam_policy_document" "ssm_read" {
  statement {
    sid       = "ReadAppParams"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:*:parameter${var.ssm_prefix}/*"]
  }
  statement {
    sid       = "DecryptSecureString"
    actions   = ["kms:Decrypt"]
    resources = ["*"] # 기본 aws/ssm 키. 운영에선 전용 KMS 키 ARN으로 좁힐 것
  }
}

resource "aws_iam_role_policy" "ssm_read" {
  name_prefix = "${var.project}-ssm-read-"
  role        = aws_iam_role.app.id
  policy      = data.aws_iam_policy_document.ssm_read.json
}

resource "aws_iam_instance_profile" "app" {
  name_prefix = "${var.project}-app-"
  role        = aws_iam_role.app.name
}
