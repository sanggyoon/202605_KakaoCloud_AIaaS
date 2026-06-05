terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # 운영에서는 S3 + DynamoDB 원격 백엔드 권장 (state 잠금/공유).
  # 지금은 로컬 state로 시작하고, 추후 아래 주석을 채워 migrate한다.
  # backend "s3" {
  #   bucket         = "peakly-tfstate"
  #   key            = "dr/terraform.tfstate"
  #   region         = "ap-northeast-2"
  #   dynamodb_table = "peakly-tflock"
  #   encrypt        = true
  # }
}
