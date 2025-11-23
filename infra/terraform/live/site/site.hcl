locals {
  site = {
    label         = "dc34"
    random_suffix = get_env("SGUID", "80a6b349")
  }

  dns = {
    zonename   = "defcon.run"
    subdomains = ["email", "run", "strapi", "ctf", "mqtt"]
    ttl        = 300
  }

  email = {
    primary_region = "us-east-1"
    zonenames      = ["email.defcon.run", "run.defcon.run"]
    smtp_prefix    = "s"

    make_site_domain      = true
    make_regional_domains = true
    make_domains          = true

    # Cross-region S3 bucket replication
    # Each region will replicate its bucket to all other regions in this list
    replica_regions = [
      {
        label = "use1"
        full  = "us-east-1"
      },
      {
        label = "cac1"
        full  = "ca-central-1"
      }
    ]

    smtp_iam_users = [
      "support@run.defcon.run",
      "strapi"
    ]

    fwd_rules = [
      {
        match   = "kurt@defcon.run"
        send_to = "whereiskurt+defcon.run@gmail.com"
      },
      {
        match   = "kurt@run.defcon.run"
        send_to = "whereiskurt+kurt-at-run.defcon.run@gmail.com"
      },
      {
        match   = "run.defcon.run"
        send_to = "whereiskurt+run.defcon.run@gmail.com"
      },
    ]
  }

  waf = {
    enabled  = false
    log_mode = "standard" # standard | realtime
    rule_set = "default"  # optional: which rule set to use
  }

  cloudfront = {
    enabled = true

    # Domains that will be served by CloudFront
    # These will be combined with dns.zonename to create full domains
    # e.g., "run" becomes "run.defcon.run"
    domains = ["run", "mqtt"]

    # Regions that will provide ALB and S3 bucket origins
    # Each region will contribute:
    # - An ALB origin for /{region_label}/*
    # - An S3 bucket origin for /{region_label}/assets/*
    regions = [
      {
        label = "use1"
        full  = "us-east-1"
      },
      {
        label = "cac1"
        full  = "ca-central-1"
      }
    ]

    # CloudFront logging configuration
    logging = {
      enabled = true
      include_cookies = true
    }

    # Price class for CloudFront distribution
    # Options: PriceClass_All, PriceClass_200, PriceClass_100
    price_class = "PriceClass_100"
  }

  dynamodb = {
    tables = [
      # Electro table with multi-region replication
      {
        table_name = "electro"

        # Table type: "standard" or "electro"
        # standard: 1 GSI (gsi1pk-gsi1sk-index)
        # electro: 2 GSIs (gsi1pk-gsi1sk-index, gsi2pk-gsi2sk-index)
        # Set to null to use custom attributes and indexes
        table_type = "electro"

        # Multi-region global table configuration
        # The first region in the list is the primary region where the table is created
        # All other regions are replicas
        replica_regions = [
          {
            label = "use1"
            full  = "us-east-1"
          },
          {
            label = "cac1"
            full  = "ca-central-1"
          }
        ]

        # Table configuration
        billing_mode     = "PAY_PER_REQUEST"
        hash_key         = "pk"
        range_key        = "sk"
        stream_enabled   = true
        stream_view_type = "NEW_AND_OLD_IMAGES"

        # TTL configuration (optional)
        ttl_enabled        = false
        ttl_attribute_name = ""
      },
      # Standard table without replication
      {
        table_name = "auth"

        table_type = "standard"

        # Single region only (no replication)
        replica_regions = [
          {
            label = "use1"
            full  = "us-east-1"
          },
          {
            label = "cac1"
            full  = "ca-central-1"
          }
        ]

        billing_mode     = "PAY_PER_REQUEST"
        hash_key         = "pk"
        range_key        = "sk"
        stream_enabled   = true
        stream_view_type = "NEW_AND_OLD_IMAGES"

        ttl_enabled        = true
        ttl_attribute_name = "ttl"
      }
    ]
  }

  ec2spots = [
    {
      count                  = 0
      region                 = "us-east-1"
      zone_name              = "run.defcon.run"
      create_dns_records     = true
      instance_type          = "t4g.medium"
      spot_price_multiplier  = 1.00
      spot_price_offset      = 0.0005
      block_duration_minutes = 0
      ec2key_name_prefix     = "ec2spot"
      ec2key_filename_prefix = "${get_env("HOME", "/tmp")}/.ssh/ec2spot"
      githubdeploykey        = get_env("TF_VAR_githubdeploykey", "NOT_SET")
    },
    {
      count                  = 0
      region                 = "ca-central-1"
      zone_name              = "run.defcon.run"
      create_dns_records     = true
      instance_type          = "t4g.medium"
      spot_price_multiplier  = 1.00
      spot_price_offset      = 0.0005
      block_duration_minutes = 0
      ec2key_name_prefix     = "ec2spot"
      ec2key_filename_prefix = "${get_env("HOME", "/tmp")}/.ssh/ec2spot"
      githubdeploykey        = get_env("TF_VAR_githubdeploykey", "NOT_SET")
    }
  ]

  ecs_clusters = [
    # App cluster in us-east-1
    {
      name            = "app"
      region          = "us-east-1"
      enable_insights = false
      cluster_type    = "FARGATE"
    },
    {
      name            = "ai"
      region          = "us-east-1"
      enable_insights = false
      cluster_type    = "FARGATE" # Will be EC2_GPU when GPU instances are needed
    },
    {
      name            = "app"
      region          = "ca-central-1"
      enable_insights = false
      cluster_type    = "FARGATE"
    }
  ]

  ecs_tasks = [
    {
      name         = "auth"
      regions      = ["us-east-1", "ca-central-1"]
      cluster_name = "app"
      task_cpu     = 512
      task_memory  = 1024

      containers = [
        {
          name               = "auth-nginx"
          image              = "auth-nginx:latest"  # Module will construct full ECR URL
          cpu                = 256
          memory             = 512
          memory_reservation = 256
          essential          = true
          command            = ["nginx", "-g", "daemon off;"]

          environment = [
            {
              name  = "APP_URL"
              value = "https://run.defcon.run"
            }
          ]

          port_mappings = [
            {
              container_port = 443
              host_port      = 443
            }
          ]

          health_check = {
            command      = ["CMD-SHELL", "curl -k -f https://localhost/hello || exit 1"]
            interval     = 60
            timeout      = 5
            retries      = 3
            start_period = 120
          }

          log_stream_prefix = "nginx"
        },
        {
          name               = "auth-app"
          image              = "auth-app:latest"  # Module will construct full ECR URL
          cpu                = 256
          memory             = 512
          memory_reservation = 256
          essential          = true
          command            = ["npm", "run", "start"]

          environment = [
            {
              name  = "NODE_ENV"
              value = "production"
            },
            {
              name  = "NEXTAUTH_URL"
              value = "https://run.defcon.run"
            }
          ]

          secrets = [
            {
              name      = "AUTH_SECRET"
              valueFrom = "/defcon-run/auth/secret"
            },
            {
              name      = "AUTH_DYNAMODB_ID"
              valueFrom = "/use1.defcon.run/next-auth/access_key"
            },
            {
              name      = "AUTH_DYNAMODB_SECRET"
              valueFrom = "/use1.defcon.run/next-auth/secret_key"
            }
          ]

          port_mappings = [
            {
              container_port = 3000
              host_port      = 3000
            }
          ]

          health_check = {
            command      = ["CMD-SHELL", "curl -f -k http://localhost:3000/hello || exit 1"]
            interval     = 30
            timeout      = 5
            retries      = 3
            start_period = 120
          }

          log_stream_prefix = "app"
        }
      ]
    }
  ]

  ecr = [
    {
      name    = "auth-nginx"
      regions = ["us-east-1", "ca-central-1"]
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name    = "auth-app"
      regions = ["us-east-1", "ca-central-1"]
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    }
  ]

  ecs_services = [
    {
      name          = "auth"
      regions       = ["us-east-1", "ca-central-1"]
      cluster_name  = "app"
      task_family   = "auth"  # Must match task definition family from ecs_tasks
      desired_count = 1

      service_discovery = {
        name           = "auth"
        container_name = "auth-app"
      }

      load_balancers = [
        {
          type                  = "alb"
          container_name        = "auth-nginx"
          container_port        = 443
          target_group_protocol = "HTTPS"
          health_check_path     = "/hello"
          health_check_protocol = "HTTPS"

          health_check = {
            healthy_threshold   = 2
            unhealthy_threshold = 2
            timeout             = 5
            interval            = 30
            matcher             = "200-499"
          }

          listener = {
            port         = 443
            protocol     = "HTTPS"
            host_headers = ["run.defcon.run", "*.run.defcon.run"]
          }
        }
      ]

      autoscaling = {
        enabled      = false
        min_capacity = 1
        max_capacity = 2

        cpu_target = {
          scale_out_threshold = 75
          scale_in_threshold  = 25
          evaluation_periods  = 2
          period              = 60
          cooldown            = 120
        }
      }
    }
  ]
}