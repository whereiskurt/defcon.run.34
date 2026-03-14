data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# Security Group: SSH and HTTPS
resource "aws_security_group" "sshhttps" {
  name        = "${var.region.label}.${var.dns.zonename}-securemgmt"
  description = "Allow TLS inbound traffic"
  vpc_id      = aws_vpc.vpc.id

  ingress = [
    {
      description      = "HTTPS port to VPC"
      from_port        = 443
      to_port          = 443
      protocol         = "tcp"
      cidr_blocks      = []
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = [data.aws_ec2_managed_prefix_list.cloudfront.id]
      security_groups  = []
    },
    {
      description      = "SSH port to VPC"
      from_port        = 22
      to_port          = 22
      protocol         = "tcp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    }
  ]

  egress = [
    {
      description      = "All outbound from VPC"
      from_port        = 0
      to_port          = 0
      protocol         = "-1"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = ["::/0"]
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    }
  ]

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-securemgmt"
    }
  )
}

# Security Group: HTTP Only
resource "aws_security_group" "http_only" {
  name        = "${var.region.label}.${var.dns.zonename}-http_only"
  description = "Allow HTTP inbound traffic for certbot setup"
  vpc_id      = aws_vpc.vpc.id

  ingress = [
    {
      description      = "HTTP port to VPC"
      from_port        = 80
      to_port          = 80
      protocol         = "tcp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    },
    {
      description      = "HTTP port 8080 to VPC"
      from_port        = 8080
      to_port          = 8080
      protocol         = "tcp"
      cidr_blocks      = []
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    },
    {
      description      = "HTTP port 3000 to VPC"
      from_port        = 3000
      to_port          = 3000
      protocol         = "tcp"
      cidr_blocks      = []
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    },
    {
      description      = "Strapi CMS port 1337 to VPC"
      from_port        = 1337
      to_port          = 1337
      protocol         = "tcp"
      cidr_blocks      = []
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    }
  ]

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-http_only"
    }
  )
}

# Security Group: PostgreSQL
resource "aws_security_group" "postgres" {
  name        = "${var.region.label}.${var.dns.zonename}-postgres"
  description = "PostgreSQL internal security group"
  vpc_id      = aws_vpc.vpc.id

  ingress {
    description     = "PostgreSQL port from HTTP and HTTPS security groups"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.http_only.id, aws_security_group.sshhttps.id]
    self            = true
  }

  egress {
    description = "Allow all outbound traffic for database updates and replication"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-postgres"
    }
  )
}

# Security Group: Etherpad
resource "aws_security_group" "etherpad" {
  name        = "${var.region.label}.${var.dns.zonename}-etherpad"
  description = "Etherpad internal security group"
  vpc_id      = aws_vpc.vpc.id

  ingress {
    description     = "Etherpad port from HTTP and HTTPS security groups"
    from_port       = 9001
    to_port         = 9001
    protocol        = "tcp"
    security_groups = [aws_security_group.http_only.id, aws_security_group.sshhttps.id]
    self            = true
  }

  egress {
    description = "Allow all outbound traffic for Etherpad dependencies"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-etherpad"
    }
  )
}

# Security Group: NLB (MQTT)
resource "aws_security_group" "nlb" {
  name        = "${var.region.label}.${var.dns.zonename}-mqtt-nlb"
  description = "MQTT rules for TLS and regular traffic"
  vpc_id      = aws_vpc.vpc.id

  ingress = [
    {
      description      = "TLS MQTT"
      from_port        = 8883
      to_port          = 8883
      protocol         = "tcp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    },
    {
      description      = "TLS MQTT (Meshtastic default)"
      from_port        = 4433
      to_port          = 4433
      protocol         = "tcp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    },
    {
      description      = "MQTT"
      from_port        = 1883
      to_port          = 1883
      protocol         = "tcp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    },
    {
      description      = "Websocket-MQTT"
      from_port        = 9001
      to_port          = 9001
      protocol         = "tcp"
      cidr_blocks      = []
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    },
    {
      description      = "TLS-WebSocket-MQTT"
      from_port        = 8443
      to_port          = 8443
      protocol         = "tcp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    },
    {
      description      = "HTTPS"
      from_port        = 443
      to_port          = 443
      protocol         = "tcp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = []
      self             = true
      prefix_list_ids  = []
      security_groups  = []
    }
  ]

  egress {
    description = "Allow all outbound traffic for MQTT broker"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-mqtt-nlb"
    }
  )
}
