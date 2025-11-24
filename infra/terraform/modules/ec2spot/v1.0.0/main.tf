locals {
  # Filter EC2 spot instances for the current region
  region_ec2spots = [
    for ec2spot in var.ec2spots :
    ec2spot if ec2spot.region == var.region.full
  ]

  # Calculate total number of EC2 spot instances in this region
  total_ec2spot_count = sum([for b in local.region_ec2spots : b.count])

  # Create a flattened list of EC2 spot instances
  ec2spot_instances = flatten([
    for idx, ec2spot in local.region_ec2spots : [
      for instance_idx in range(ec2spot.count) : {
        key                    = "${ec2spot.region}-${idx}-${instance_idx}"
        region                 = ec2spot.region
        zone_name              = ec2spot.zone_name
        create_dns_records     = ec2spot.create_dns_records
        instance_type          = ec2spot.instance_type
        spot_price_multiplier  = ec2spot.spot_price_multiplier
        spot_price_offset      = ec2spot.spot_price_offset
        block_duration_minutes = ec2spot.block_duration_minutes
        ec2key_name            = "${ec2spot.ec2key_name_prefix}-${var.region.label}-${instance_idx}"
        ec2key_filename        = ec2spot.ec2key_filename_prefix != "" ? "${ec2spot.ec2key_filename_prefix}.${var.region.label}.${instance_idx}.pem" : ""
        githubdeploykey        = ec2spot.githubdeploykey
        user_data              = ec2spot.user_data
        availability_zone      = var.availability_zones[instance_idx % length(var.availability_zones)]
        subnet_id              = var.public_subnets[instance_idx % length(var.public_subnets)]
        instance_name          = "ec2spot-${var.region.label}-${instance_idx}"
      }
    ]
  ])

  ec2spot_map = {
    for ec2spot in local.ec2spot_instances :
    ec2spot.key => ec2spot
  }
}

# Get latest Amazon Linux 2023 ARM64 AMI
data "aws_ami" "base_ami" {
  count = local.total_ec2spot_count > 0 ? 1 : 0

  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Get spot price for instances
data "aws_ec2_spot_price" "price" {
  for_each = local.ec2spot_map

  instance_type     = each.value.instance_type
  availability_zone = each.value.availability_zone

  filter {
    name   = "product-description"
    values = ["Linux/UNIX"]
  }
}

# Security group for EC2 spot instances
resource "aws_security_group" "ec2spot" {
  count = local.total_ec2spot_count > 0 ? 1 : 0

  name        = "ec2spot-${var.region.label}-${var.dns.zonename}"
  description = "Security group for EC2 spot hosts"
  vpc_id      = var.vpc_id

  # SSH access
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "SSH access"
  }

  # HTTPS access
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS access"
  }

  # Allow all outbound traffic
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name = "ec2spot-${var.region.label}"
  }
}

# TLS private keys for EC2 spot instances
resource "tls_private_key" "ec2spot" {
  for_each = local.ec2spot_map

  algorithm = "RSA"
  rsa_bits  = 4096
}

# AWS key pairs
resource "aws_key_pair" "ec2spot" {
  for_each = local.ec2spot_map

  key_name   = each.value.ec2key_name
  public_key = tls_private_key.ec2spot[each.key].public_key_openssh

  tags = {
    Name = each.value.ec2key_name
  }
}

# Save private keys locally
resource "local_file" "ec2spot_key" {
  for_each = local.ec2spot_map

  depends_on      = [aws_key_pair.ec2spot]
  file_permission = "0400"
  content         = tls_private_key.ec2spot[each.key].private_key_pem
  filename        = each.value.ec2key_filename
}

# IAM role for SSM access
resource "aws_iam_role" "ec2spot_ssm" {
  count = local.total_ec2spot_count > 0 ? 1 : 0

  name = "ec2spot-ssm-${var.region.label}-${var.site.random_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "ec2spot-ssm-${var.region.label}"
  }
}

resource "aws_iam_role_policy_attachment" "ec2spot_ssm" {
  count = local.total_ec2spot_count > 0 ? 1 : 0

  role       = aws_iam_role.ec2spot_ssm[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2spot" {
  count = local.total_ec2spot_count > 0 ? 1 : 0

  name = "ec2spot-profile-${var.region.label}-${var.site.random_suffix}"
  role = aws_iam_role.ec2spot_ssm[0].name

  tags = {
    Name = "ec2spot-profile-${var.region.label}"
  }
}

# Default user data script
locals {
  default_user_data = <<-EOF
    #!/bin/bash
    yum update -y
    yum install -y amazon-ssm-agent
    systemctl enable amazon-ssm-agent
    systemctl start amazon-ssm-agent
  EOF
}

# Spot instance requests for EC2 spot instances
resource "aws_spot_instance_request" "ec2spot" {
  for_each = local.ec2spot_map

  ami                    = data.aws_ami.base_ami[0].image_id
  instance_type          = each.value.instance_type
  spot_price             = format("%.6f", (data.aws_ec2_spot_price.price[each.key].spot_price * each.value.spot_price_multiplier) + each.value.spot_price_offset)
  user_data              = each.value.user_data != "" ? each.value.user_data : local.default_user_data
  subnet_id              = each.value.subnet_id
  availability_zone      = each.value.availability_zone
  key_name               = each.value.ec2key_name
  vpc_security_group_ids = [aws_security_group.ec2spot[0].id]
  iam_instance_profile   = aws_iam_instance_profile.ec2spot[0].name

  associate_public_ip_address = true
  wait_for_fulfillment        = true

  tags = {
    Name = each.value.instance_name
  }

  lifecycle {
    ignore_changes = [
      vpc_security_group_ids,
      spot_price
    ]
  }

  depends_on = [
    aws_key_pair.ec2spot
  ]
}

# Route53 DNS records for EC2 spot instances (optional)
resource "aws_route53_record" "ec2spot" {
  for_each = {
    for k, v in local.ec2spot_map :
    k => v if v.create_dns_records
  }

  zone_id = var.zone_map[each.value.zone_name].zone_id
  name    = "${each.value.instance_name}.${each.value.zone_name}"
  type    = "A"
  ttl     = var.dns.ttl
  records = [aws_spot_instance_request.ec2spot[each.key].public_ip]

  depends_on = [
    aws_spot_instance_request.ec2spot
  ]
}
