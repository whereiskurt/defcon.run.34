locals {
  versions = {
    nginx = trimspace(file("${get_terragrunt_dir()}/VERSION.nginx"))
    app   = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  # ECR repositories for this service
  ecr_repositories = [
    {
      name                 = "run-auth-nginx"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-auth-app"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    }
  ]

  # ECS Task definition for the auth service
  task = {
    name         = "run-auth"
    regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name = "app"
    # CON-WINDOW CAPACITY BUMP (2026-08-03) — 1 vCPU / 2 GB. TEMPORARY: revert to
    # 512/1024 (and the container split below to 128/256/128 + 384/768/384) after
    # DEF CON 34 unless the load says otherwise.
    #
    # History, so these numbers are not re-litigated later: this was originally
    # 256/512 "minimum sizing" and peaked ~98% CPU. That ~98% figure is quoted in
    # older notes and refers to the 0.25-vCPU task, NOT this one. It was then
    # bumped to 512/1024, after which measured CPU is ~0.75% avg / ~2.5% max
    # (CloudWatch, cluster app-use1-dc34, 2026-08-03 02:30 ET, idle). So this bump
    # is HEADROOM for a con-day surge, not relief of a current saturation.
    #
    # Deliberately NO autoscaling — the block below stays enabled = false. Its
    # 120s scale-out cooldown would land after a doors-open spike anyway, and a
    # second task changes the OIDC failure modes (an in-flight authorize ->
    # interaction -> token chain spans 3 hops and a scale-in can drop it).
    #
    # Fargate constraint: 1024 CPU requires memory in [2048..8192]. Leaving
    # task_memory at 1024 is NOT a legal pairing and task registration would fail.
    task_cpu     = 1024
    task_memory  = 2048

    containers = [
      {
        name               = "run-auth-nginx"
        image              = "run-auth-nginx:${local.versions.nginx}"
        # Con-window bump, doubled with the task (was 128/256/128). The 25/75
        # nginx:app split is preserved. Container memory is a HARD limit, so
        # raising only task_memory would leave both containers capped where they
        # were and the extra GB unusable.
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
            value = "https://auth.{{SITE_DOMAIN}}"
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
        name               = "run-auth-app"
        image              = "run-auth-app:${local.versions.app}"
        # Con-window bump, doubled with the task (was 384/768/384). This is the
        # Node/oidc-provider process — the actual auth chokepoint — so it keeps
        # 75% of the new ceiling, the same share it had before.
        cpu                = 768
        memory             = 1536
        memory_reservation = 768
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
            name  = "NEXTAUTH_URL"
            value = "https://auth.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            name  = "AUTH_COOKIE_DOMAIN"
            value = ".{{SITE_DOMAIN}}"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "AUTH_SES_REGION"
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
          }
        ]

        secrets = [
          {
            name      = "AUTH_SES_SMTP_FROM"
            valueFrom = "/{{SITE_LABEL}}/ses/from_address"
          },
          {
            name      = "AUTH_JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/secret"
          },
          {
            name      = "AUTH_DYNAMODB_ID"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-auth-authjs/access_key_id"
          },
          {
            name      = "AUTH_DYNAMODB_SECRET"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-auth-authjs/secret_access_key"
          },
          {
            name      = "AUTH_DYNAMODB_DBNAME"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-auth-authjs/table_name"
          },
          {
            name      = "AUTH_ELECTRO_ID"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-auth-electro/access_key_id"
          },
          {
            name      = "AUTH_ELECTRO_SECRET"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-auth-electro/secret_access_key"
          },
          {
            name      = "AUTH_ELECTRO_DBNAME"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-auth-electro/table_name"
          },
          {
            name      = "AUTH_QUOTA_ID"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-quota-electro/access_key_id"
          },
          {
            name      = "AUTH_QUOTA_SECRET"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-quota-electro/secret_access_key"
          },
          {
            name      = "AUTH_QUOTA_DBNAME"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-quota-electro/table_name"
          },
          {
            name      = "AUTH_GITHUB_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/github/client_id"
          },
          {
            name      = "AUTH_GITHUB_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/github/client_secret"
          },
          {
            name      = "AUTH_STRAVA_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strava/client_id"
          },
          {
            name      = "AUTH_STRAVA_CLIENT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strava/client_secret"
          },
          {
            name      = "AUTH_DISCORD_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/discord/client_id"
          },
          {
            name      = "AUTH_DISCORD_CLIENT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/discord/client_secret"
          },
          {
            name      = "AUTH_LINKEDIN_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/linkedin/client_id"
          },
          {
            name      = "AUTH_LINKEDIN_CLIENT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/linkedin/client_secret"
          },
          {
            name      = "OIDC_COOKIE_KEYS"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/oidc/cookie_keys"
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
            name      = "OIDC_CMS_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/oidc_client_id"
          },
          {
            name      = "OIDC_CMS_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/oidc_client_secret"
          },
          {
            name      = "OIDC_GPXSTUDIO_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/gpxstudio/client_id"
          },
          {
            name      = "OIDC_GPXSTUDIO_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/gpxstudio/client_secret"
          },
          {
            name      = "OIDC_FLASH_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/flash/client_id"
          },
          {
            name      = "OIDC_FLASH_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/flash/client_secret"
          },
          {
            name      = "OIDC_BIB_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/client_id"
          },
          {
            name      = "OIDC_BIB_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/client_secret"
          },
          {
            name      = "AUTH_INTERNAL_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret"
          },
          {
            name      = "ALTCHA_HMAC_KEY"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/altcha/secret"
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
        table_name = "run-auth-electro"
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

        # TTL configuration (optional)
        ttl_enabled        = false
        ttl_attribute_name = ""
      },
      # Standard table without replication

      {
        table_name = "run-auth-authjs"
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
      },
      # Centralized quota service table
      {
        table_name = "run-quota-electro"
        table_type = "electro"

        # Multi-region global table configuration
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

        ttl_enabled        = false
        ttl_attribute_name = ""
      }
    ]
  }

  # ECS Service definition for the auth service
  service = {
    name          = "run-auth"
    regions       = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name  = "app"
    task_family   = "run-auth" # Must match task definition family from task above
    desired_count = 1

    service_discovery = {
      name           = "run-auth"
      container_name = "run-auth-app"
    }

    load_balancers = [
      {
        type                  = "alb"
        container_name        = "run-auth-nginx"
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
          host_headers = ["auth.{{SITE_DOMAIN}}", "*.auth.{{SITE_DOMAIN}}"]
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
