locals {
  versions = {
    nginx = trimspace(file("${get_terragrunt_dir()}/VERSION.nginx"))
    app   = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  # ECR repositories for this service
  ecr_repositories = [
    {
      name                 = "run-human-nginx"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-human-app"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
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
    regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name = "app"
    task_cpu     = 256
    task_memory  = 512

    containers = [
      {
        name               = "run-human-nginx"
        image              = "run-human-nginx:${local.versions.nginx}"
        cpu                = 64
        memory             = 128
        memory_reservation = 64
        essential          = true
        command            = ["nginx", "-g", "daemon off;"]

        # Note: readonlyRootFilesystem disabled - Fargate doesn't support tmpfs mounts
        # and nginx requires writable paths (/var/cache/nginx, /var/run)
        readonly_root_filesystem = false

        environment = [
          {
            name  = "APP_URL"
            value = "https://run.{{SITE_DOMAIN}}"
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
        cpu                = 192
        memory             = 384
        memory_reservation = 192
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
            value = "https://run.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            # NEXTAUTH_URL for backwards compatibility
            name  = "NEXTAUTH_URL"
            value = "https://run.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "AUTH_COOKIE_DOMAIN"
            value = ".{{SITE_DOMAIN}}"
          },
          {
            name  = "RUN_SES_REGION"
            value = "{{REGION}}"
          },
          # URL configuration for cross-service communication
          {
            name  = "SITE_DOMAIN"
            value = "{{SITE_DOMAIN}}"
          },
          {
            name  = "AUTH_PUBLIC_URL"
            value = "https://auth.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            # Internal auth URL via service discovery (container-to-container)
            name  = "AUTH_INTERNAL_URL"
            value = "http://run-auth.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:3000/{{REGION_LABEL}}"
          },
          {
            name  = "RUN_PUBLIC_URL"
            value = "https://run.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            name  = "GPX_PUBLIC_URL"
            value = "https://gpx.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            name  = "CMS_PUBLIC_URL"
            value = "https://cms.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            # Internal CMS worker URL via service discovery (container-to-container)
            name  = "CMS_INTERNAL_URL"
            value = "http://run-cms-worker.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:1337"
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
            # Same server secret the meshtk fleet uses to derive ghost keypairs
            # and (meshtk#10) real TOTP seeds — /admin/ghosts reveals the seed
            # the deployed bot validates (Phase 67).
            name      = "MESHTK_GHOST_KEY_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/ghost-key-secret"
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
            # Strapi API token for internal CMS queries (generated by CMS master bootstrap)
            name      = "STRAPI_API_TOKEN"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/run_human_api_token"
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
      },
      {
        label = "apse1"
        full  = "ap-southeast-1"
      }
        ]

        # Table configuration
        billing_mode     = "PAY_PER_REQUEST"
        hash_key         = "pk"
        range_key        = "sk"
        stream_enabled   = true
        stream_view_type = "NEW_AND_OLD_IMAGES"

        # Extra attributes / GSIs appended on top of the electro base schema.
        # runnerCode-index is used by Phase 22's reconciliation Lambda to look
        # up Bib records by the comment code payers include in Venmo/CashApp
        # payments. Projection is ALL (per CONTEXT.md decision #5).
        attributes = [
          { name = "runnerCode", type = "S" }
        ]
        global_secondary_indexes = [
          {
            name            = "runnerCode-index"
            hash_key        = "runnerCode"
            projection_type = "ALL"
          }
        ]

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
      },
      {
        label = "apse1"
        full  = "ap-southeast-1"
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
    regions       = ["us-east-1", "ca-central-1", "ap-southeast-1"]
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
          host_headers = ["run.{{SITE_DOMAIN}}", "*.run.{{SITE_DOMAIN}}"]
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
      regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]

      lifecycle = {
        uploads_expire_days   = 7 # Clean up uploads after 7 days
        processed_expire_days = 0 # Never expire processed files
        enable_versioning     = true
      }

      replication = {
        enabled = true
        replica_regions = [
          
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
      regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]

      # Reference to user_uploads bucket (by name from user_uploads config)
      user_upload_name = "run-human"

      dynamodb_table_ref = "run-human-electro"

      on_upload_lambda = {
        source_path = "${get_repo_root()}/infra/terraform/live/site/services/run.human/lambdas/on-upload"
        timeout     = 30
        memory_size = 256
      }

      on_process_lambda = {
        source_path = "${get_repo_root()}/infra/terraform/live/site/services/run.human/lambdas/on-process"
        timeout     = 300
        memory_size = 1024
      }
    }
  ]
}
