locals {
  versions = {
    nginx = trimspace(file("${get_terragrunt_dir()}/VERSION.nginx"))
    app   = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  # ECR repositories for this service
  ecr_repositories = [
    {
      name                 = "auth-nginx"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "auth-app"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    }
  ]

  # ECS Task definition for the auth service
  task = {
    name         = "auth"
    regions      = ["us-east-1", "ca-central-1"]
    cluster_name = "app"
    task_cpu     = 512
    task_memory  = 1024

    containers = [
      {
        name               = "auth-nginx"
        image              = "auth-nginx:${local.versions.nginx}"
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
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -k -f https://localhost/hello || exit 1"]
          interval     = 60
          timeout      = 5
          retries      = 3
          start_period = 120
        }

        log_stream_prefix = "nginx"
      },
      {
        name               = "auth-app"
        image              = "auth-app:${local.versions.app}"
        cpu                = 256
        memory             = 512
        memory_reservation = 256
        essential          = true
        command            = ["node", "server.js"]

        environment = [
          {
            name  = "NODE_ENV"
            value = "production"
          },
          {
            name  = "HOSTNAME"
            value = "0.0.0.0"
          },
          {
            name  = "NEXTAUTH_URL"
            value = "https://auth.defcon.run"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "AUTH_SES_REGION"
            value = "{{REGION}}"
          }
        ]

        secrets = [
          {
            name      = "AUTH_SES_SMTP_FROM"
            valueFrom = "/{{SITE_LABEL}}/ses/from_address"
          },
          {
            name      = "AUTH_JWT_SECRET"
            valueFrom = "/defcon.run/auth/secret"
          },
          {
            name      = "AUTH_DYNAMODB_ID"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/auth/access_key_id"
          },
          {
            name      = "AUTH_DYNAMODB_SECRET"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/auth/secret_access_key"
          },
          {
            name      = "AUTH_DYNAMODB_DBNAME"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/auth/table_name"
          },
          {
            name      = "AUTH_ELECTRO_ID"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/electro/access_key_id"
          },
          {
            name      = "AUTH_ELECTRO_SECRET"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/electro/secret_access_key"
          },
          {
            name      = "AUTH_ELECTRO_DBNAME"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/electro/table_name"
          },
          {
            name      = "AUTH_GITHUB_ID"
            valueFrom = "/defcon.run/auth/github/id"
          },
          {
            name      = "AUTH_GITHUB_SECRET"
            valueFrom = "/defcon.run/auth/github/secret"
          },
          {
            name      = "AUTH_STRAVA_CLIENT_ID"
            valueFrom = "/defcon.run/auth/strava/id"
          },
          {
            name      = "AUTH_STRAVA_CLIENT_SECRET"
            valueFrom = "/defcon.run/auth/strava/secret"
          },
          {
            name      = "AUTH_DISCORD_CLIENT_ID"
            valueFrom = "/defcon.run/auth/discord/id"
          },
          {
            name      = "AUTH_DISCORD_CLIENT_SECRET"
            valueFrom = "/defcon.run/auth/discord/secret"
          }
        ]

        port_mappings = [
          {
            container_port = 3000
            host_port      = 3000
          }
        ]

        health_check = {
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -f http://localhost:3000/login || exit 1"]
          interval     = 30
          timeout      = 5
          retries      = 3
          start_period = 120
        }

        log_stream_prefix = "app"
      }
    ]
  }

  # DynamoDB tables for the auth service
  dynamodb = {
    tables = [
      # Electro table with multi-region replication
      {
        table_name = "electro"
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
        table_type = "nextauth"

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

  # ECS Service definition for the auth service
  service = {
    name          = "auth"
    regions       = ["us-east-1", "ca-central-1"]
    cluster_name  = "app"
    task_family   = "auth"  # Must match task definition family from task above
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
          host_headers = ["auth.defcon.run", "*.auth.defcon.run"]
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
}
