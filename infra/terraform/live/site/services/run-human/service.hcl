locals {
  versions = {
    nginx = trimspace(file("${get_terragrunt_dir()}/VERSION.nginx"))
    app   = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  # ECR repositories for this service
  ecr_repositories = [
    {
      name                 = "run-human-nginx"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-human-app"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    }
  ]

  # ECS Task definition for the run-human service
  task = {
    name         = "run-human"
    regions      = ["us-east-1", "ca-central-1"]
    cluster_name = "app"
    task_cpu     = 512
    task_memory  = 1024

    containers = [
      {
        name               = "run-human-nginx"
        image              = "run-human-nginx:${local.versions.nginx}"
        cpu                = 256
        memory             = 512
        memory_reservation = 256
        essential          = true
        command            = ["nginx", "-g", "daemon off;"]

        # Note: readonlyRootFilesystem disabled - Fargate doesn't support tmpfs mounts
        # and nginx requires writable paths (/var/cache/nginx, /var/run)
        readonly_root_filesystem = false

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
        name               = "run-human-app"
        image              = "run-human-app:${local.versions.app}"
        cpu                = 256
        memory             = 512
        memory_reservation = 256
        essential          = true
        command            = ["node", "server.js"]

        # Note: readonlyRootFilesystem disabled - Fargate doesn't support tmpfs mounts
        # and Node.js requires writable paths (/tmp)
        readonly_root_filesystem = false

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
            name  = "REGION_SHORT"
            value = "{{REGION_LABEL}}"
          },
          {
            # AUTH_URL is preferred by Auth.js v5 - must include region prefix for correct callback URL construction
            name  = "AUTH_URL"
            value = "https://run.defcon.run/{{REGION_LABEL}}"
          },
          {
            # NEXTAUTH_URL for backwards compatibility
            name  = "NEXTAUTH_URL"
            value = "https://run.defcon.run/{{REGION_LABEL}}"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "AUTH_COOKIE_DOMAIN"
            value = ".defcon.run"
          },
          {
            name  = "RUN_SES_REGION"
            value = "{{REGION}}"
          }
        ]

        secrets = [
          {
            name      = "AUTH_JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/secret"
          },
          {
            name      = "OIDC_RUNHUMAN_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/runhuman/client_id"
          },
          {
            name      = "OIDC_RUNHUMAN_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/runhuman/client_secret"
          },
          {
            name      = "AUTH_INTERNAL_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret"
          },
          {
            name      = "RUN_SES_SMTP_FROM"
            valueFrom = "/{{SITE_LABEL}}/ses/from_address"
          },
          {
            name      = "RUN_DYNAMODB_ID"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-authjs/access_key_id"
          },
          {
            name      = "RUN_DYNAMODB_SECRET"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-authjs/secret_access_key"
          },
          {
            name      = "RUN_DYNAMODB_DBNAME"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-authjs/table_name"
          },
          {
            name      = "RUN_ELECTRO_ID"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-electro/access_key_id"
          },
          {
            name      = "RUN_ELECTRO_SECRET"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-electro/secret_access_key"
          },
          {
            name      = "RUN_ELECTRO_DBNAME"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-electro/table_name"
          },
          {
            name      = "S3_UPLOADS_ACCESS_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-human/access_key_id"
          },
          {
            name      = "S3_UPLOADS_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-human/secret_access_key"
          },
          {
            name      = "S3_UPLOADS_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-human/bucket_name"
          },
          {
            name      = "S3_UPLOADS_REGION"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-human/bucket_region"
          }
        ]

        port_mappings = [
          {
            container_port = 3000
            host_port      = 3000
          }
        ]

        health_check = {
          # Health check path includes region prefix because Next.js basePath is /{region}
          # {{REGION_LABEL}} is substituted by ecs-task module (e.g., use1, cac1)
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -f http://localhost:3000/{{REGION_LABEL}}/ || exit 1"]
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
        table_name = "run-human-electro"
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
        table_name = "run-human-authjs"
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
    name          = "run-human"
    regions       = ["us-east-1", "ca-central-1"]
    cluster_name  = "app"
    task_family   = "run-human" # Must match task definition family from task above
    desired_count = 1

    service_discovery = {
      name           = "run-human"
      container_name = "run-human-app"
    }

    load_balancers = [
      {
        type                  = "alb"
        container_name        = "run-human-nginx"
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

  # User upload S3 bucket configuration
  user_uploads = [
    {
      name         = "run-human"
      service_name = "run-human"
      regions      = ["us-east-1", "ca-central-1"]

      lifecycle = {
        uploads_expire_days   = 7 # Clean up uploads after 7 days
        processed_expire_days = 0 # Never expire processed files
        enable_versioning     = true
      }

      replication = {
        enabled = true
        replica_regions = [
          { label = "use1", full = "us-east-1" },
          { label = "cac1", full = "ca-central-1" }
        ]
      }
    }
  ]

  # Upload processor Lambda configuration
  # Processes uploads when files are added to S3 bucket
  upload_processors = [
    {
      name         = "run-human"
      service_name = "run-human"
      regions      = ["us-east-1", "ca-central-1"]

      # Reference to user_uploads bucket (by name from user_uploads config)
      user_upload_name = "run-human"

      dynamodb_table_ref = "run-human-electro"

      on_upload_lambda = {
        source_path = "${get_repo_root()}/infra/terraform/live/site/services/run-human/lambdas/on-upload"
        timeout     = 30
        memory_size = 256
      }

      on_process_lambda = {
        source_path = "${get_repo_root()}/infra/terraform/live/site/services/run-human/lambdas/on-process"
        timeout     = 300
        memory_size = 1024
      }
    }
  ]
}
