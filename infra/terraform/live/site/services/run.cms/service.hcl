locals {
  versions = {
    nginx = trimspace(file("${get_terragrunt_dir()}/VERSION.nginx"))
    app   = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  # ECR repositories for CMS service
  ecr_repositories = [
    {
      name                 = "run-cms-nginx"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-cms-app"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    }
  ]

  # CMS Master task definition (us-east-1 only - handles writes)
  task_master = {
    name         = "run-cms-master"
    regions      = ["us-east-1"]
    cluster_name = "app"
    task_cpu     = 512
    task_memory  = 1024

    containers = [
      {
        name               = "run-cms-nginx"
        image              = "run-cms-nginx:${local.versions.nginx}"
        cpu                = 128
        memory             = 256
        memory_reservation = 128
        essential          = true
        command            = ["nginx", "-g", "daemon off;"]

        readonly_root_filesystem = false

        environment = [
          {
            name  = "APP_URL"
            value = "https://cms.{{SITE_DOMAIN}}"
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
        name               = "run-cms-app"
        image              = "run-cms-app:${local.versions.app}"
        cpu                = 384
        memory             = 768
        memory_reservation = 512
        essential          = true
        command            = ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.master.conf"]

        readonly_root_filesystem = false

        environment = [
          {
            name  = "NODE_ENV"
            value = "production"
          },
          {
            name  = "HOST"
            value = "0.0.0.0"
          },
          {
            name  = "PORT"
            value = "1337"
          },
          {
            name  = "REGION_SHORT"
            value = "{{REGION_LABEL}}"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "CMS_MODE"
            value = "master"
          },
          {
            name  = "DATABASE_FILENAME"
            value = "/data/strapi.db"
          },
          {
            name  = "STRAPI_URL"
            value = "https://cms.{{SITE_DOMAIN}}"
          },
          {
            name  = "SES_FROM_ADDRESS"
            value = "support@email.{{SITE_DOMAIN}}"
          },
          {
            name  = "SES_REPLYTO_ADDRESS"
            value = "reply-to@email.{{SITE_DOMAIN}}"
          },
          {
            name  = "OIDC_REDIRECT_URI"
            value = "https://cms.{{SITE_DOMAIN}}/{{REGION_LABEL}}/strapi-plugin-sso/oidc/callback"
          },
          {
            name  = "OIDC_AUTHORIZATION_ENDPOINT"
            value = "https://auth.{{SITE_DOMAIN}}/{{REGION_LABEL}}/api/oidc/auth"
          },
          {
            name  = "OIDC_TOKEN_ENDPOINT"
            value = "https://auth.{{SITE_DOMAIN}}/{{REGION_LABEL}}/api/oidc/token"
          },
          {
            name  = "OIDC_USER_INFO_ENDPOINT"
            value = "https://auth.{{SITE_DOMAIN}}/{{REGION_LABEL}}/api/oidc/me"
          },
          {
            name  = "OIDC_REQUIRED_SERVICES"
            value = "cms"
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
          }
        ]

        secrets = [
          {
            name      = "ADMIN_JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/admin_jwt_secret"
          },
          {
            name      = "API_TOKEN_SALT"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/api_token_salt"
          },
          {
            name      = "APP_KEYS"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/app_keys"
          },
          {
            name      = "TRANSFER_TOKEN_SALT"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/transfer_token_salt"
          },
          {
            name      = "JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/jwt_secret"
          },
          {
            name      = "STRAPI_OIDC_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/oidc_client_id"
          },
          {
            name      = "STRAPI_OIDC_CLIENT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/oidc_client_secret"
          },
          # Litestream credentials - replicated from master region (us-east-1) to all regions
          {
            name      = "S3_LITESTREAM_ACCESS_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-litestream/access_key_id"
          },
          {
            name      = "S3_LITESTREAM_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-litestream/secret_access_key"
          },
          {
            name      = "S3_LITESTREAM_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-litestream/bucket_name"
          },
          {
            name      = "S3_LITESTREAM_REGION"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-litestream/bucket_region"
          },
          {
            name      = "S3_MEDIA_ACCESS_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-media/access_key_id"
          },
          {
            name      = "S3_MEDIA_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-media/secret_access_key"
          },
          {
            name      = "S3_MEDIA_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-media/bucket_name"
          },
          {
            name      = "S3_MEDIA_REGION"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-media/bucket_region"
          },
          # Internal secret for server-to-server validation with auth service
          # Used by services-validation middleware to re-validate services claim
          {
            name      = "AUTH_INTERNAL_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret"
          },
          # Admin bootstrap credentials (master only)
          # Seeds super admin on first boot so register-admin endpoint is disabled
          {
            name      = "STRAPI_ADMIN_EMAIL"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/admin_email"
          },
          {
            name      = "STRAPI_ADMIN_PASSWORD"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/admin_password"
          }
        ]

        port_mappings = [
          {
            container_port = 1337
            host_port      = 1337
          }
        ]

        health_check = {
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -f http://localhost:1337/_health || exit 1"]
          interval     = 30
          timeout      = 5
          retries      = 3
          start_period = 180
        }

        log_stream_prefix = "app"
      }
    ]
  }

  # CMS Worker task definition (both regions - read-only)
  task_worker = {
    name         = "run-cms-worker"
    regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name = "app"
    task_cpu     = 512
    task_memory  = 1024

    containers = [
      {
        name               = "run-cms-nginx"
        image              = "run-cms-nginx:${local.versions.nginx}"
        cpu                = 128
        memory             = 256
        memory_reservation = 128
        essential          = true
        command            = ["nginx", "-g", "daemon off;"]

        readonly_root_filesystem = false

        environment = [
          {
            name  = "APP_URL"
            value = "https://cms.{{SITE_DOMAIN}}"
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
        name               = "run-cms-app"
        image              = "run-cms-app:${local.versions.app}"
        cpu                = 384
        memory             = 768
        memory_reservation = 512
        essential          = true
        command            = ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.worker.conf"]

        readonly_root_filesystem = false

        environment = [
          {
            name  = "NODE_ENV"
            value = "production"
          },
          {
            name  = "HOST"
            value = "0.0.0.0"
          },
          {
            name  = "PORT"
            value = "1337"
          },
          {
            name  = "REGION_SHORT"
            value = "{{REGION_LABEL}}"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "CMS_MODE"
            value = "worker"
          },
          {
            name  = "DATABASE_FILENAME"
            value = "/data/strapi.db"
          },
          {
            name  = "STRAPI_URL"
            value = "https://cms.{{SITE_DOMAIN}}"
          },
          {
            name  = "SES_FROM_ADDRESS"
            value = "support@email.{{SITE_DOMAIN}}"
          },
          {
            name  = "SES_REPLYTO_ADDRESS"
            value = "reply-to@email.{{SITE_DOMAIN}}"
          }
        ]

        secrets = [
          {
            name      = "ADMIN_JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/admin_jwt_secret"
          },
          {
            name      = "API_TOKEN_SALT"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/api_token_salt"
          },
          {
            name      = "APP_KEYS"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/app_keys"
          },
          {
            name      = "TRANSFER_TOKEN_SALT"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/transfer_token_salt"
          },
          {
            name      = "JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/jwt_secret"
          },
          # Litestream credentials - replicated from master region (us-east-1) to all regions
          {
            name      = "S3_LITESTREAM_ACCESS_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-litestream/access_key_id"
          },
          {
            name      = "S3_LITESTREAM_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-litestream/secret_access_key"
          },
          {
            name      = "S3_LITESTREAM_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-litestream/bucket_name"
          },
          {
            name      = "S3_LITESTREAM_REGION"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-litestream/bucket_region"
          },
          {
            name      = "S3_MEDIA_ACCESS_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-media/access_key_id"
          },
          {
            name      = "S3_MEDIA_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-media/secret_access_key"
          },
          {
            name      = "S3_MEDIA_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-media/bucket_name"
          },
          {
            name      = "S3_MEDIA_REGION"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/cms-media/bucket_region"
          }
        ]

        port_mappings = [
          {
            container_port = 1337
            host_port      = 1337
          }
        ]

        health_check = {
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -f http://localhost:1337/_health || exit 1"]
          interval     = 30
          timeout      = 5
          retries      = 3
          start_period = 180
        }

        log_stream_prefix = "app"
      }
    ]
  }

  # S3 storage buckets for CMS
  cms_storage = [
    # Litestream replication bucket (single region - master writes here)
    # SSM parameters replicated to other regions so workers can access master bucket
    {
      name         = "cms-litestream"
      service_name = "cms"
      regions      = ["us-east-1"]

      lifecycle = {
        uploads_expire_days   = 0
        processed_expire_days = 0
        enable_versioning     = true
      }

      replication = {
        enabled = false
        replica_regions = [
          
        ]
      }

      # Litestream needs full bucket access (not prefix-restricted like user uploads)
      full_bucket_access = true

      # Replicate SSM parameters to these regions so workers can access master bucket credentials
      # This creates /<site_label>/uploads/cac1/cms-litestream/* params pointing to the use1 bucket
      ssm_replicate_to = [
        
      ]
    },
    # Media storage bucket (both regions with replication)
    {
      name         = "cms-media"
      service_name = "cms"
      regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]

      lifecycle = {
        uploads_expire_days   = 0
        processed_expire_days = 0
        enable_versioning     = true
      }

      replication = {
        enabled = true
        replica_regions = [
          
        ]
      }

      # Enable CloudFront OAC access for serving media via CDN
      # This allows cms.<domain>/{region}/cms/* to serve media files
      cloudfront_access = true
    }
  ]

  # CMS Master service (us-east-1 only - handles admin and write operations)
  service_master = {
    name          = "run-cms-master"
    regions       = ["us-east-1"]
    cluster_name  = "app"
    task_family   = "run-cms-master"
    desired_count = 1

    service_discovery = {
      name           = "run-cms-master"
      container_name = "run-cms-app"
    }

    load_balancers = [
      # Route Strapi admin panel and SSO plugin callbacks
      # - /use1/admin* - Strapi admin panel with regional prefix
      # - /use1/strapi-plugin-sso/* - SSO plugin OIDC callbacks
      {
        type                  = "alb"
        container_name        = "run-cms-nginx"
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
          port          = 443
          protocol      = "HTTPS"
          host_headers  = ["cms.{{SITE_DOMAIN}}"]
          path_patterns = ["/{{REGION_LABEL}}/*"]
          priority      = 100
        }
      }
    ]

    autoscaling = {
      enabled      = false
      min_capacity = 1
      max_capacity = 1

      cpu_target = {
        scale_out_threshold = 75
        scale_in_threshold  = 25
        evaluation_periods  = 2
        period              = 60
        cooldown            = 120
      }
    }
  }

  # CMS Worker service (both regions - read-only replicas accessed via service discovery)
  # No ALB needed - workers are called internally by Next.js via service discovery
  # Litestream syncs database from master's S3 bucket
  service_worker = {
    name          = "run-cms-worker"
    regions       = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name  = "app"
    task_family   = "run-cms-worker"
    desired_count = 1

    service_discovery = {
      name           = "run-cms-worker"
      container_name = "run-cms-app"
    }

    # No load_balancers - internal service discovery only

    autoscaling = {
      enabled      = true
      min_capacity = 1
      max_capacity = 3

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
