locals {
  versions = {
    nginx = trimspace(file("${get_terragrunt_dir()}/VERSION.nginx"))
    app   = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  # ECR repositories for this service
  ecr_repositories = [
    {
      name                 = "run-flash-nginx"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-flash-app"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    }
  ]

  # ECS Task definition for the run-flash service
  task = {
    name         = "run-flash"
    regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name = "app"
    task_cpu     = 512
    task_memory  = 1024

    containers = [
      {
        name               = "run-flash-nginx"
        image              = "run-flash-nginx:${local.versions.nginx}"
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
            value = "https://flash.{{SITE_DOMAIN}}"
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
        name               = "run-flash-app"
        image              = "run-flash-app:${local.versions.app}"
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
            value = "https://flash.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            # NEXTAUTH_URL for backwards compatibility
            name  = "NEXTAUTH_URL"
            value = "https://flash.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "AUTH_COOKIE_DOMAIN"
            value = ".{{SITE_DOMAIN}}"
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
            name  = "FLASH_PUBLIC_URL"
            value = "https://flash.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            name  = "RUN_DYNAMODB_REGION"
            value = "{{REGION}}"
          }
        ]

        secrets = [
          {
            name      = "AUTH_JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/secret"
          },
          {
            name      = "OIDC_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/flash/client_id"
          },
          {
            name      = "OIDC_CLIENT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/flash/client_secret"
          },
          {
            name      = "AUTH_INTERNAL_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret"
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

  # ECS Service definition for the flash service
  service = {
    name          = "run-flash"
    regions       = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name  = "app"
    task_family   = "run-flash" # Must match task definition family from task above
    desired_count = 1

    service_discovery = {
      name           = "run-flash"
      container_name = "run-flash-app"
    }

    load_balancers = [
      {
        type                  = "alb"
        container_name        = "run-flash-nginx"
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
          host_headers = ["flash.{{SITE_DOMAIN}}"]
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
