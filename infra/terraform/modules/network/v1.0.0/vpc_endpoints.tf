# VPC Endpoint for ECR API
resource "aws_vpc_endpoint" "ecr_api" {
  count               = var.vpc_endpoints.enabled ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${var.region.full}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private_subnet.*.id
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.sshhttps.id] # Allow HTTPS (443)

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-ecr-api"
    }
  )
}

# VPC Endpoint for ECR DKR
resource "aws_vpc_endpoint" "ecr_dkr" {
  count               = var.vpc_endpoints.enabled ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${var.region.full}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private_subnet.*.id
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.sshhttps.id] # Allow HTTPS (443)

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-ecr-dkr"
    }
  )
}

# VPC Endpoint for CloudWatch Logs
resource "aws_vpc_endpoint" "logs" {
  count               = var.vpc_endpoints.enabled ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${var.region.full}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private_subnet.*.id
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.sshhttps.id] # Allow HTTPS (443)

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-logs"
    }
  )
}

# VPC Gateway Endpoint for S3
resource "aws_vpc_endpoint" "s3_gateway_endpoint" {
  count             = var.vpc_endpoints.enabled ? 1 : 0
  vpc_id            = aws_vpc.vpc.id
  service_name      = "com.amazonaws.${var.region.full}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = [
    aws_route_table.public.id,
    aws_route_table.private.id
  ]

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect    = "Allow",
        Principal = "*",
        Action    = "s3:*",
        Resource  = "*"
      }
    ]
  })

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-s3"
    }
  )
}

# VPC Endpoint for SSM
resource "aws_vpc_endpoint" "ssm" {
  count               = var.vpc_endpoints.enabled ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${var.region.full}.ssm"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private_subnet.*.id
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.sshhttps.id] # Allow HTTPS (443)

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-ssm"
    }
  )
}

# VPC Endpoint for SSM Messages
resource "aws_vpc_endpoint" "ssm_messages" {
  count               = var.vpc_endpoints.enabled ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${var.region.full}.ssmmessages"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private_subnet.*.id
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.sshhttps.id] # Allow HTTPS (443)

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-ssm-messages"
    }
  )
}

# VPC Endpoint for EC2 Messages
resource "aws_vpc_endpoint" "ec2_messages" {
  count               = var.vpc_endpoints.enabled ? 1 : 0
  vpc_id              = aws_vpc.vpc.id
  service_name        = "com.amazonaws.${var.region.full}.ec2messages"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private_subnet.*.id
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.sshhttps.id] # Allow HTTPS (443)

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-ec2-messages"
    }
  )
}
