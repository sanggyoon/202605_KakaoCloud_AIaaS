provider "aws" {
  region = var.region

  # 모든 리소스에 공통 태그 자동 부착
  default_tags {
    tags = {
      Project   = var.project
      Env       = "dr"
      ManagedBy = "terraform"
    }
  }
}
