locals {
  versions = {
    app = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  # ECR repository for run-gpx (single container, no nginx)
  ecr_repositories = [
    {
      name                 = "run-gpx-app"
      regions              = ["us-east-1", "ca-central-1"]
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
    regions      = ["us-east-1", "ca-central-1"]
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
            # AUTH_URL for Auth.js - GPX Studio at gpxstudio.defcon.run
            name  = "AUTH_URL"
            value = "https://gpxstudio.defcon.run"
          },
          {
            name  = "NEXTAUTH_URL"
            value = "https://gpxstudio.defcon.run"
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
            # Auth service URL for internal API calls
            name  = "AUTH_SERVICE_URL"
            value = "http://run-auth.app.local:3000"
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
          {
            name      = "GPX_DYNAMODB_ID"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-gpx-electro/access_key_id"
          },
          {
            name      = "GPX_DYNAMODB_SECRET"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-gpx-electro/secret_access_key"
          },
          {
            name      = "GPX_DYNAMODB_DBNAME"
            valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-gpx-electro/table_name"
          },
          {
            name      = "S3_GPX_ACCESS_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-gpx/access_key_id"
          },
          {
            name      = "S3_GPX_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-gpx/secret_access_key"
          },
          {
            name      = "S3_GPX_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-gpx/bucket_name"
          },
          {
            name      = "S3_GPX_REGION"
            valueFrom = "/{{SITE_LABEL}}/uploads/{{REGION_LABEL}}/run-gpx/bucket_region"
          },
          {
            name      = "MAPBOX_DEFAULT_TOKEN"
            valueFrom = "/{{SITE_LABEL}}/secrets/global/mapbox/public_token"
          }
        ]

        port_mappings = [
          {
            container_port = 3000
            host_port      = 3000
          }
        ]

        health_check = {
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -f http://localhost:3000/api/health || exit 1"]
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

  # ECS Service definition
  service = {
    name          = "run-gpx"
    regions       = ["us-east-1", "ca-central-1"]
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
        health_check_path     = "/api/health"
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
          host_headers = ["gpxstudio.defcon.run"]
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
