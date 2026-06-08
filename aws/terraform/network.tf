# ── VPC + 인터넷 게이트웨이 ──────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-igw" }
}

# ── 서브넷 (AZ별 public / private) ───────────────────────────────────
resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project}-public-${var.azs[count.index]}"
    Tier = "public"
  }
}

# 비용 절감을 위해 NAT 게이트웨이를 제거했다(아래 참고). 그래서 앱 ASG·DB EC2는
# public 서브넷에 공인 IP로 배치되고, private 서브넷은 현재 미사용(격리)로 남겨둔다.
# (자세한 트레이드오프: aws/COST-OPTIMIZATION.md)
resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.azs[count.index]

  tags = {
    Name = "${var.project}-private-${var.azs[count.index]}"
    Tier = "private-unused"
  }
}

# ── 라우팅: public → IGW ─────────────────────────────────────────────
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# private 서브넷은 라우트 테이블 미연결 → VPC main RT(local 전용)만 적용 = 인터넷 격리.
# NAT를 다시 도입하려면 여기에 private RT(→NAT)와 association을 복원하면 된다.
