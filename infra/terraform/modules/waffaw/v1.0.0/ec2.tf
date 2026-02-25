# EC2 instances for stable-IP testing (Tier 1)
# Conditional on enabled AND ec2_count > 0

data "aws_ami" "amazon_linux" {
  count = var.waffaw.enabled && var.waffaw.ec2_count > 0 ? 1 : 0

  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_launch_template" "waffaw" {
  count = var.waffaw.enabled && var.waffaw.ec2_count > 0 ? 1 : 0

  name_prefix   = "waffaw-${var.region.label}-"
  image_id      = data.aws_ami.amazon_linux[0].id
  instance_type = var.waffaw.ec2_instance_type

  iam_instance_profile {
    name = aws_iam_instance_profile.node[0].name
  }

  vpc_security_group_ids = [aws_security_group.node[0].id]

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size = 20
      volume_type = "gp3"
    }
  }

  user_data = base64encode(templatefile("${path.module}/ec2-userdata.sh.tpl", {
    region         = var.region.full
    ecr_repo       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region.full}.amazonaws.com"
    image_uri      = var.image_uri
    control_bucket = aws_s3_bucket.control[0].bucket
    log_group      = aws_cloudwatch_log_group.waffaw[0].name
    log_level      = "normal"
    image_tag      = element(split(":", var.image_uri), 1)
  }))

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2 # Allow IMDS access from Docker containers
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name   = "waffaw-${var.region.label}"
      Region = var.region.label
      Site   = var.site.label
    }
  }

  tags = {
    Name   = "waffaw-lt-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

resource "aws_autoscaling_group" "waffaw" {
  count = var.waffaw.enabled && var.waffaw.ec2_count > 0 ? 1 : 0

  name_prefix      = "waffaw-${var.region.label}-"
  min_size         = 0
  max_size         = var.waffaw.ec2_max_count
  desired_capacity = var.waffaw.ec2_count

  vpc_zone_identifier = aws_subnet.public[*].id

  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 0
      on_demand_percentage_above_base_capacity = var.waffaw.ec2_use_spot ? 0 : 100
      spot_allocation_strategy                 = "capacity-optimized"
    }

    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.waffaw[0].id
        version            = aws_launch_template.waffaw[0].latest_version
      }

      override {
        instance_type = var.waffaw.ec2_instance_type
      }

      override {
        instance_type = "t3.large"
      }

      override {
        instance_type = "m5.large"
      }
    }
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 0
    }
  }

  tag {
    key                 = "Name"
    value               = "waffaw-${var.region.label}"
    propagate_at_launch = true
  }

  tag {
    key                 = "Region"
    value               = var.region.label
    propagate_at_launch = true
  }

  tag {
    key                 = "Site"
    value               = var.site.label
    propagate_at_launch = true
  }
}
