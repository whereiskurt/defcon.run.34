locals {
  versions = {
    app = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  # ECR repository for run-gpx (single container, no nginx)
  ecr_repositories = [
    {
      name                 = "run-gpx-app"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    }
  ]

  # ECS Task definition for the run-gpx service
  task = {
    name         = "run-gpx"
    regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name = "app"
    task_cpu     = 256
    task_memory  = 512

    containers = [
      {
        name               = "run-gpx-app"
        image              = "run-gpx-app:${local.versions.app}"
        cpu                = 256
        memory             = 512
        memory_reservation = 256
        essential          = true
        command            = ["node", "server.js"]

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
            # For next.config.ts basePath and assetPrefix
            name  = "WEBAPP_ORIGIN"
            value = "gpx.{{SITE_DOMAIN}}"
          },
          {
            name  = "WEBAPP_PREFIX"
            value = "{{REGION_LABEL}}/assets"
          },
          {
            # AUTH_URL for Auth.js - full path including /api/auth
            # When using full path in AUTH_URL, do NOT set basePath in auth.ts
            name  = "AUTH_URL"
            value = "https://gpx.{{SITE_DOMAIN}}/{{REGION_LABEL}}/api/auth"
          },
          {
            # NEXTAUTH_URL for backwards compatibility
            name  = "NEXTAUTH_URL"
            value = "https://gpx.{{SITE_DOMAIN}}/{{REGION_LABEL}}/api/auth"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            # DynamoDB region for gpx-file.ts client
            name  = "DYNAMODB_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "AUTH_COOKIE_DOMAIN"
            value = ".{{SITE_DOMAIN}}"
          },
          {
            # Auth service URL for internal API calls (via service discovery)
            name  = "AUTH_SERVICE_URL"
            value = "http://run-auth.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:3000/{{REGION_LABEL}}"
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
            # Internal run.human URL via service discovery (container-to-container) —
            # used server-side to proxy the public check-ins feed for the
            # "User Check-ins" map overlay.
            name  = "RUN_HUMAN_INTERNAL_URL"
            value = "http://run-human.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:3000/{{REGION_LABEL}}"
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
            # Internal CMS URL via service discovery (container-to-container) —
            # used server-side to fetch curated Route titles for public overlays.
            # Points at the MASTER: the read-only API token is minted by the
            # master and the worker replica rejects it (401, API-token hash /
            # Litestream sync mismatch). us-east-1 only today, which matches
            # this us1 manifest. (Kurt 2026-07-04)
            name  = "CMS_INTERNAL_URL"
            value = "http://run-cms-master.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:1337"
          }
        ]

        secrets = [
          {
            name      = "AUTH_JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/secret"
          },
          {
            name      = "OIDC_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/gpxstudio/client_id"
          },
          {
            name      = "OIDC_CLIENT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/gpxstudio/client_secret"
          },
          # DynamoDB credentials - names must match webapp code (gpx-file.ts)
          {
            name      = "DYNAMODB_ACCESS_KEY"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-gpx-electro/access_key_id"
          },
          {
            name      = "DYNAMODB_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-gpx-electro/secret_access_key"
          },
          {
            name      = "DYNAMODB_TABLE"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-gpx-electro/table_name"
          },
          # S3 credentials - names must match webapp code (s3-client.ts)
          {
            name      = "S3_UPLOADS_ACCESS_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-gpx/access_key_id"
          },
          {
            name      = "S3_UPLOADS_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-gpx/secret_access_key"
          },
          {
            name      = "S3_UPLOADS_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-gpx/bucket_name"
          },
          {
            name      = "S3_UPLOADS_REGION"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-gpx/bucket_region"
          },
          {
            name      = "MAPBOX_DEFAULT_TOKEN"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mapbox/public_token"
          },
          # Internal secret for service-to-service auth (quota API calls to run-auth)
          {
            name      = "AUTH_INTERNAL_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret"
          },
          # Read-only Strapi token (shared run-human-internal) — lets the public
          # maps manifest fetch curated Route titles from the CMS worker.
          {
            name      = "STRAPI_API_TOKEN"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/run_human_api_token"
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
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -f http://localhost:3000/{{REGION_LABEL}}/api/health || exit 1"]
          interval     = 30
          timeout      = 5
          retries      = 3
          start_period = 120
        }

        log_stream_prefix = "app"
      }
    ]
  }

  # DynamoDB table for GPX file metadata
  dynamodb = {
    tables = [
      {
        table_name = "run-gpx-electro"
        table_type = "electro"

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

  # S3 storage bucket for user-uploaded GPX files
  gpx_storage = [
    {
      name         = "run-gpx"
      service_name = "run-gpx"
      regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]

      lifecycle = {
        uploads_expire_days   = 0 # Keep GPX files indefinitely
        processed_expire_days = 0
        enable_versioning     = true
      }

      replication = {
        enabled = true
        replica_regions = [
          
        ]
      }

      full_bucket_access = false # User-isolated prefix access
      cloudfront_access  = false # Presigned URLs, not direct CDN
    }
  ]

  # ECS Service definition
  service = {
    name          = "run-gpx"
    regions       = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name  = "app"
    task_family   = "run-gpx"
    desired_count = 1

    service_discovery = {
      name           = "run-gpx"
      container_name = "run-gpx-app"
    }

    load_balancers = [
      {
        type                  = "alb"
        container_name        = "run-gpx-app"
        container_port        = 3000
        target_group_protocol = "HTTP"
        health_check_path     = "/{{REGION_LABEL}}/api/health"
        health_check_protocol = "HTTP"

        health_check = {
          healthy_threshold   = 2
          unhealthy_threshold = 2
          timeout             = 5
          interval            = 30
          matcher             = "200"
        }

        listener = {
          port         = 443
          protocol     = "HTTPS"
          host_headers = ["gpx.{{SITE_DOMAIN}}"]
          # No path_patterns - route all gpx.<domain> requests to run-gpx
          # This allows Auth.js callbacks without region prefix to work
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
