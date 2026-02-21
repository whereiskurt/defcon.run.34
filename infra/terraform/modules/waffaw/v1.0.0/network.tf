data "aws_availability_zones" "available" {
  count = var.waffaw.enabled ? 1 : 0
  state = "available"
}

locals {
  az_count = var.waffaw.enabled ? min(3, length(data.aws_availability_zones.available[0].names)) : 0
  azs      = var.waffaw.enabled ? slice(data.aws_availability_zones.available[0].names, 0, local.az_count) : []
}

# Waffaw VPC — public-only, no NAT, isolated from production
resource "aws_vpc" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  cidr_block           = "10.100.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "waffaw-${var.region.label}-${var.site.label}"
  }
}

# Public subnets — one per AZ
resource "aws_subnet" "public" {
  count = var.waffaw.enabled ? local.az_count : 0

  vpc_id                  = aws_vpc.waffaw[0].id
  cidr_block              = cidrsubnet("10.100.0.0/16", 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "waffaw-${var.region.label}-public-${local.azs[count.index]}"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  vpc_id = aws_vpc.waffaw[0].id

  tags = {
    Name = "waffaw-${var.region.label}-igw"
  }
}

# Route table for public subnets
resource "aws_route_table" "public" {
  count = var.waffaw.enabled ? 1 : 0

  vpc_id = aws_vpc.waffaw[0].id

  tags = {
    Name = "waffaw-${var.region.label}-public"
  }
}

# Default route to IGW
resource "aws_route" "public_igw" {
  count = var.waffaw.enabled ? 1 : 0

  route_table_id         = aws_route_table.public[0].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.waffaw[0].id
}

# Associate subnets with route table
resource "aws_route_table_association" "public" {
  count = var.waffaw.enabled ? local.az_count : 0

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

# Security group: egress-only (nodes initiate all connections)
resource "aws_security_group" "node" {
  count = var.waffaw.enabled ? 1 : 0

  name        = "waffaw-node-${var.region.label}-${var.site.label}"
  description = "Waffaw node - egress only, no ingress"
  vpc_id      = aws_vpc.waffaw[0].id

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "waffaw-node-${var.region.label}"
  }
}
