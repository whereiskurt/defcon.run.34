resource "aws_vpc" "vpc" {
  cidr_block           = var.vpc.cidr_block
  enable_dns_hostnames = var.vpc.enable_dns_hostnames
  enable_dns_support   = var.vpc.enable_dns_support

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}"
    }
  )
}

# Public Subnets
resource "aws_subnet" "public_subnet" {
  vpc_id                  = aws_vpc.vpc.id
  count                   = length(var.vpc.public_subnets_cidr)
  cidr_block              = element(var.vpc.public_subnets_cidr, count.index)
  availability_zone       = element(local.availability_zones, count.index)
  map_public_ip_on_launch = true

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-public-${element(local.availability_zones, count.index)}"
    }
  )
}

# Private Subnets
resource "aws_subnet" "private_subnet" {
  vpc_id                  = aws_vpc.vpc.id
  count                   = length(var.vpc.private_subnets_cidr)
  cidr_block              = element(var.vpc.private_subnets_cidr, count.index)
  availability_zone       = element(local.availability_zones, count.index)
  map_public_ip_on_launch = false

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-private-${element(local.availability_zones, count.index)}"
    }
  )
}

# Route Tables
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.vpc.id

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-private"
    }
  )
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.vpc.id

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-public"
    }
  )
}

# Route Table Associations
resource "aws_route_table_association" "public" {
  count          = length(var.vpc.public_subnets_cidr)
  subnet_id      = element(aws_subnet.public_subnet.*.id, count.index)
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(var.vpc.private_subnets_cidr)
  subnet_id      = element(aws_subnet.private_subnet.*.id, count.index)
  route_table_id = aws_route_table.private.id
}

# Internet Gateway
resource "aws_internet_gateway" "ig" {
  vpc_id = aws_vpc.vpc.id

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-igw"
    }
  )
}

# Route to Internet Gateway
resource "aws_route" "public_igw" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.ig.id
}
