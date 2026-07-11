locals {
  # VERSION.* files are stubbed by Phase 23 (image builds). Fallback keeps
  # Phase 20 terragrunt plan clean until then.
  versions = {
    nginx = try(trimspace(file("${get_terragrunt_dir()}/VERSION.nginx")), "0.0.0")
    app   = try(trimspace(file("${get_terragrunt_dir()}/VERSION.app")), "0.0.0")
  }

  # ECR repositories for this service (multiregion pattern, matches auth/flash/human;
  # inert until cac1/apse1 infra exists — release-all probes ECR + skips missing regions)
  ecr_repositories = [
    {
      name                 = "run-bib-nginx"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-bib-app"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
  ]

  # ECS Task definition for the run-bib service (multiregion pattern)
  task = {
    name         = "run-bib"
    regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name = "app"
    task_cpu     = 256
    task_memory  = 512

    containers = [
      {
        name               = "run-bib-nginx"
        image              = "run-bib-nginx:${local.versions.nginx}"
        cpu                = 64
        memory             = 128
        memory_reservation = 64
        essential          = true
        command            = ["nginx", "-g", "daemon off;"]

        readonly_root_filesystem = false

        environment = [
          {
            name  = "APP_URL"
            value = "https://bib.{{SITE_DOMAIN}}"
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
        name               = "run-bib-app"
        image              = "run-bib-app:${local.versions.app}"
        cpu                = 192
        memory             = 384
        memory_reservation = 192
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
            name  = "AWS_REGION"
            value = "{{REGION}}"
          },
          {
            name  = "SITE_DOMAIN"
            value = "{{SITE_DOMAIN}}"
          },
          {
            name  = "AUTH_URL"
            value = "https://bib.{{SITE_DOMAIN}}/{{REGION_LABEL}}/api/auth"
          },
          {
            name  = "NEXTAUTH_URL"
            value = "https://bib.{{SITE_DOMAIN}}/{{REGION_LABEL}}/api/auth"
          },
          {
            name  = "AUTH_COOKIE_DOMAIN"
            value = ".{{SITE_DOMAIN}}"
          },
          {
            name  = "AUTH_PUBLIC_URL"
            value = "https://auth.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            name  = "AUTH_INTERNAL_URL"
            value = "http://run-auth.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:3000/{{REGION_LABEL}}"
          },
          {
            name  = "BIB_PUBLIC_URL"
            value = "https://bib.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
          },
          {
            name  = "RUN_HUMAN_INTERNAL_URL"
            value = "http://run-human.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:3000/{{REGION_LABEL}}"
          },
          {
            # CMS (Strapi worker) — read-only source for the live UI copy catalog
            # (Phase 36/37). Mirrors run.human; reads from the regional worker
            # replica (Litestream-restored). Without this, copy.ts short-circuits
            # (`!baseUrl` → {}) and the app never reads the CMS (snapshot only).
            name  = "CMS_INTERNAL_URL"
            value = "http://run-cms-worker.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:1337"
          },
          {
            # Stripe test-vs-live selector. "false" → reads the test-mode
            # secret_key / webhook_signing_secret + test product IDs. "true" →
            # reads the *_live SSM params + live product IDs. Both credential
            # sets live in SSM permanently; this flag picks which pair the app
            # uses. Flip to "true" + redeploy to go live; flip back to roll back.
            name  = "STRIPE_LIVE_MODE"
            value = "true"
          }
        ]

        # NOTE: OIDC_CLIENT_ID / OIDC_CLIENT_SECRET reference SSM params that
        # Phase 21 will provision when it registers the bib OIDC client via
        # the shared secrets module. Path is stable, so this definition is
        # forward-compatible; deploy will fail until Phase 21 lands.
        secrets = [
          {
            # Read-only run-human-internal API token (Phase 35), shared with
            # run.human. Pairs with CMS_INTERNAL_URL so copy.ts can read the
            # ui-string catalog. Read-only: write attempts with it are denied.
            name      = "STRAPI_API_TOKEN"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/strapi/run_human_api_token"
          },
          {
            name      = "AUTH_JWT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/secret"
          },
          {
            name      = "AUTH_INTERNAL_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret"
          },
          {
            name      = "OIDC_CLIENT_ID"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/client_id"
          },
          {
            name      = "OIDC_CLIENT_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/client_secret"
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
            name      = "STRIPE_SECRET_KEY"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/stripe/secret_key"
          },
          {
            name      = "STRIPE_WEBHOOK_SIGNING_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/stripe/webhook_signing_secret"
          },
          {
            # Live-mode Stripe credentials. Injected alongside the test-mode
            # pair (both always present in the task); the app selects which to
            # read via STRIPE_LIVE_MODE. Placeholder-safe: decrypts fine until
            # Kurt sets the real sk_live_* / whsec_* out-of-band via AWS CLI.
            name      = "STRIPE_SECRET_KEY_LIVE"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/stripe/secret_key_live"
          },
          {
            name      = "STRIPE_WEBHOOK_SIGNING_SECRET_LIVE"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/stripe/webhook_signing_secret_live"
          },
          {
            # Live-mode Stripe product IDs (String params, delivered via
            # secrets{} like the handles below). App reads these in live mode so
            # a dashboard product swap is a put-parameter + task refresh — no
            # image rebuild. Test mode falls back to the code defaults.
            name      = "STRIPE_PRODUCT_BIB_LIVE"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/stripe/product_bib_live"
          },
          {
            name      = "STRIPE_PRODUCT_GENERAL_LIVE"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/stripe/product_general_live"
          },
          {
            # Delivered via secrets{} so the task role gets read access without
            # extra IAM plumbing, even though the param is a String type.
            name      = "VENMO_HANDLE"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/venmo/handle"
          },
          {
            name      = "CASHAPP_HANDLE"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/bib/cashapp/handle"
          }
        ]

        port_mappings = [
          {
            container_port = 3000
            host_port      = 3000
          }
        ]

        health_check = {
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

  # ECS Service definition for the run-bib service (multiregion pattern)
  service = {
    name          = "run-bib"
    regions       = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name  = "app"
    task_family   = "run-bib"
    desired_count = 1

    service_discovery = {
      name           = "run-bib"
      container_name = "run-bib-app"
    }

    load_balancers = [
      {
        type                  = "alb"
        container_name        = "run-bib-nginx"
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
          host_headers = ["bib.{{SITE_DOMAIN}}"]
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
