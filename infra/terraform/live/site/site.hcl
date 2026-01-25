locals {
  # Load service definitions from infra/services/
  ecs_auth_service      = read_terragrunt_config("./services/run-auth/service.hcl")
  ecs_run_human_service = read_terragrunt_config("./services/run-human/service.hcl")
  ecs_cms_service       = read_terragrunt_config("./services/run-cms/service.hcl")
  ecs_gpx_service       = read_terragrunt_config("./services/run-gpx/service.hcl")

  site = {
    label         = "dc34"
    random_suffix = get_env("SGUID", "80a6b349")
    skip_regions  = ["ca-central-1"] # Set to ["ca-central-1"] to skip that region
  }

  dns = {
    zonename   = "defcon.run"
    subdomains = ["email", "run", "auth", "cms", "gpx"]
    ttl        = 300
  }

  email = {
    enabled        = true
    primary_region = "us-east-1"
    zonenames      = ["email.defcon.run", "run.defcon.run", "auth.defcon.run"]
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
      "run.defcon.run",
      "auth.defcon.run",
      "cms.defcon.run"
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
        match   = "defcon.run"
        send_to = "whereiskurt+defcon.run@gmail.com"
      },
    ]
  }

  waf = {
    enabled  = true
    log_mode = "standard" # standard | realtime
  }

  cloudfront = {
    enabled = true

    # Domains that will be served by CloudFront
    # These will be combined with dns.zonename to create full domains
    # e.g., "run" becomes "run.defcon.run"
    domains = ["auth", "run", "cms", "gpx"]

    ##Map fronted domain "auth.defcon.run" to the ruleset called "auth"
    waf_rulesets = {
      "auth" = "auth" # Use the 'api' ruleset from waf.hcl
      #"run"  = "default" # Use the 'default' ruleset from waf.hcl
    }

    # Regions that will provide ALB and S3 bucket origins
    # Each region will contribute:
    # - An ALB origin for /{region_label}/*
    # - An S3 bucket origin for /{region_label}/assets/*
    #                           /{region_label}/index.html
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

    logging = {
      enabled         = true
      include_cookies = false
    }

    # Price class for CloudFront distribution
    # Options: PriceClass_All, PriceClass_200, PriceClass_100
    price_class = "PriceClass_100"

  }

  ec2spots = {
    enabled = false
    instances = [
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
  }

  ecs_clusters = {
    enabled = true
    clusters = [
      {
        name            = "app"
        region          = "us-east-1"
        enable_insights = false
        cluster_type    = "FARGATE"
      },
      {
        name            = "app"
        region          = "ca-central-1"
        enable_insights = false
        cluster_type    = "FARGATE"
      }
    ]
  }

  dynamodb = {
    enabled = true
    tables = concat(
      local.ecs_auth_service.locals.dynamodb.tables,
      local.ecs_run_human_service.locals.dynamodb.tables,
      local.ecs_gpx_service.locals.dynamodb.tables
    )
  }

  ecr = {
    enabled = true
    repositories = concat(
      local.ecs_auth_service.locals.ecr_repositories,
      local.ecs_run_human_service.locals.ecr_repositories,
      local.ecs_cms_service.locals.ecr_repositories,
      local.ecs_gpx_service.locals.ecr_repositories
    )
  }

  ecs_tasks = {
    enabled = true
    tasks = [
      local.ecs_auth_service.locals.task,
      local.ecs_run_human_service.locals.task,
      local.ecs_cms_service.locals.task_master,
      local.ecs_cms_service.locals.task_worker,
      local.ecs_gpx_service.locals.task
    ]
  }

  ecs_services = {
    enabled = true
    services = [
      local.ecs_auth_service.locals.service,
      local.ecs_run_human_service.locals.service,
      local.ecs_cms_service.locals.service_master,
      local.ecs_cms_service.locals.service_worker,
      local.ecs_gpx_service.locals.service
    ]
  }

  user_uploads = {
    enabled = true
    buckets = concat(
      try(local.ecs_run_human_service.locals.user_uploads, []),
      try(local.ecs_cms_service.locals.cms_storage, []),
      # GPX Studio storage bucket for user-uploaded GPX files
      [
        {
          name         = "run-gpx"
          service_name = "run-gpx"
          regions      = ["us-east-1", "ca-central-1"]

          lifecycle = {
            uploads_expire_days   = 0 # Keep GPX files indefinitely
            processed_expire_days = 0
            enable_versioning     = true
          }

          replication = {
            enabled = true
            replica_regions = [
              { label = "use1", full = "us-east-1" },
              { label = "cac1", full = "ca-central-1" }
            ]
          }

          full_bucket_access = false  # User-isolated prefix access
          cloudfront_access  = false  # Presigned URLs, not direct CDN
        }
      ]
    )
  }

  upload_processors = {
    enabled = true
    processors = concat(
      try(local.ecs_run_human_service.locals.upload_processors, [])
      # Future: local.ecs_run_gpx_service.locals.upload_processors
    )
  }

  # Cross-regional secrets (OAuth/OIDC providers, JWT secrets, etc.)
  # Values loaded from .secrets.json file (gitignored) or TF_VAR_secret_values env var
  secrets = {
    enabled = true

    # Set to true to use Secrets Manager with automatic replication
    # Set to false to use SSM Parameter Store (created in each region)
    use_secrets_manager = false

    # Primary region for Secrets Manager (only used when use_secrets_manager = true)
    primary_region = "us-east-1"

    # Regions to replicate to (only used when use_secrets_manager = true)
    replica_regions = [
      {
        label = "cac1"
        full  = "ca-central-1"
      }
    ]

    # Path prefix templates - supports {{SITE_LABEL}}, {{REGION_LABEL}}, {{REGION}}
    # SSM: includes region since each region has its own parameters
    ssm_prefix = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}"
    # Secrets Manager: no region since it replicates automatically
    sm_prefix = "/{{SITE_LABEL}}/secrets"

    # Secret structure definitions - values come from .secrets.json or env var
    definitions = {
      strava = {
        description = "Strava OAuth credentials"
        keys        = ["client_id", "client_secret"]
      }
      github = {
        description = "GitHub OAuth credentials"
        keys        = ["client_id", "client_secret"]
      }
      discord = {
        description = "Discord OAuth credentials"
        keys        = ["client_id", "client_secret"]
      }
      jwt = {
        description = "JWT signing secrets"
        keys        = ["secret", "internal_secret"]
      }
      oidc = {
        description = "OIDC cookie encryption keys"
        keys        = ["cookie_keys"]
      }
      runhuman = {
        description = "RunHuman OIDC client credentials"
        keys        = ["client_id", "client_secret"]
      }
      altcha = {
        description = "ALTCHA proof-of-work secret"
        keys        = ["secret"]
      }
      origin_verify = {
        description = "CloudFront origin verification secret for multi-region routing"
        keys        = ["secret"]
      }
      strapi = {
        description = "Strapi CMS secrets"
        keys        = ["admin_jwt_secret", "api_token_salt", "app_keys", "transfer_token_salt", "jwt_secret", "oidc_client_id", "oidc_client_secret"]
      }
      gpxstudio = {
        description = "GPX Studio OIDC client credentials"
        keys        = ["client_id", "client_secret"]
      }
      mapbox = {
        description = "Mapbox API tokens"
        keys        = ["public_token"]
        global      = true # Global secret, not region-specific
      }
    }
  }

  secret_values = jsondecode(
    # Try SOPS encrypted file first (decrypt on the fly)
    fileexists("${get_terragrunt_dir()}/.secrets.sops.json")
    ? run_cmd("--terragrunt-quiet", "sops", "--decrypt", "${get_terragrunt_dir()}/.secrets.sops.json")
    # Fall back to plaintext file
    : fileexists("${get_terragrunt_dir()}/.secrets.json")
    ? file("${get_terragrunt_dir()}/.secrets.json")
    : "{}"
  )

  github_oidc = {
    enabled     = true
    github_org  = "whereiskurt"   # Your GitHub org/user
    github_repo = "defcon.run.34" # Your repository name

    # Management account for cross-account Route53 access
    # Set this to your management account ID to get the trust policy output
    # After deploying, create the delegate role in the management account
    management_account_id = get_env("TF_VAR_MANAGEMENT_ACCOUNT_ID", "123456789012")

    roles = [
      # Terragrunt role - for infrastructure deployments
      # Equivalent to your local "terraform" profile + management profile
      {
        name                    = "terragrunt"
        description             = "Terragrunt infrastructure deployments"
        environment_restriction = "terraform-apply" # Only terraform-apply environment can assume this role
        max_session_duration    = 3600

        # Full admin for now - scope down for production
        policy_arns = [
          "arn:aws:iam::aws:policy/AdministratorAccess"
        ]

        # Cross-account access to management account for Route53
        cross_account_arns = [
          "arn:aws:iam::481723467561:role/dc34-github-delegate"
        ]
      },

      # Application role - for app deployments (ECR, S3, ECS)
      # Equivalent to your local "application" profile
      {
        name                 = "application"
        description          = "Application deployments (ECR, S3, ECS)"
        branch_restriction   = "main" # Only main branch can deploy
        max_session_duration = 3600

        # Scoped permissions for app deployment
        inline_policies = [
          {
            name = "ecr-push"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "ECRAuth"
                  Effect = "Allow"
                  Action = [
                    "ecr:GetAuthorizationToken"
                  ]
                  Resource = "*"
                },
                {
                  Sid    = "ECRPush"
                  Effect = "Allow"
                  Action = [
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:BatchGetImage",
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:PutImage",
                    "ecr:InitiateLayerUpload",
                    "ecr:UploadLayerPart",
                    "ecr:CompleteLayerUpload",
                    "ecr:DescribeRepositories",
                    "ecr:ListImages"
                  ]
                  Resource = "arn:aws:ecr:*:*:repository/dc34-*"
                }
              ]
            })
          },
          {
            name = "s3-assets"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "S3Assets"
                  Effect = "Allow"
                  Action = [
                    "s3:PutObject",
                    "s3:GetObject",
                    "s3:DeleteObject",
                    "s3:ListBucket"
                  ]
                  Resource = [
                    "arn:aws:s3:::dc34-*",
                    "arn:aws:s3:::dc34-*/*"
                  ]
                }
              ]
            })
          },
          {
            name = "ecs-deploy"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "ECSUpdate"
                  Effect = "Allow"
                  Action = [
                    "ecs:UpdateService",
                    "ecs:DescribeServices",
                    "ecs:DescribeClusters",
                    "ecs:DescribeTaskDefinition"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "ssm-read"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "SSMRead"
                  Effect = "Allow"
                  Action = [
                    "ssm:GetParameter",
                    "ssm:GetParameters"
                  ]
                  Resource = "arn:aws:ssm:*:*:parameter/dc34/*"
                }
              ]
            })
          }
        ]
      },

      # Read-only role for PR plan previews
      {
        name        = "readonly"
        description = "Read-only for PR plan previews"
        # No branch/environment restriction - all PRs can use this
        max_session_duration = 3600

        policy_arns = [
          "arn:aws:iam::aws:policy/ReadOnlyAccess"
        ]

        inline_policies = [
          {
            name = "kms-sops-decrypt"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "SOPSDecrypt"
                  Effect = "Allow"
                  Action = [
                    "kms:Decrypt",
                    "kms:DescribeKey"
                  ]
                  Resource = [
                    "arn:aws:kms:us-east-1:427284555693:key/mrk-1025ab1d1f5848fc9d680bdd7e827c80",
                    "arn:aws:kms:ca-central-1:427284555693:key/mrk-1025ab1d1f5848fc9d680bdd7e827c80"
                  ]
                }
              ]
            })
          },
          {
            name = "terraform-state-lock"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "DynamoDBStateLock"
                  Effect = "Allow"
                  Action = [
                    "dynamodb:PutItem",
                    "dynamodb:GetItem",
                    "dynamodb:DeleteItem"
                  ]
                  Resource = [
                    "arn:aws:dynamodb:us-east-1:427284555693:table/tf-defcon-run-use1-*",
                    "arn:aws:dynamodb:ca-central-1:427284555693:table/tf-defcon-run-cac1-*"
                  ]
                },
                {
                  Sid    = "S3StateAccess"
                  Effect = "Allow"
                  Action = [
                    "s3:GetObject",
                    "s3:PutObject",
                    "s3:DeleteObject",
                    "s3:ListBucket"
                  ]
                  Resource = [
                    "arn:aws:s3:::tf-defcon-run-use1-*",
                    "arn:aws:s3:::tf-defcon-run-use1-*/*",
                    "arn:aws:s3:::tf-defcon-run-cac1-*",
                    "arn:aws:s3:::tf-defcon-run-cac1-*/*"
                  ]
                }
              ]
            })
          }
        ]

        # Cross-account access to management account for Route53
        cross_account_arns = [
          "arn:aws:iam::481723467561:role/dc34-github-delegate"
        ]
      },

      # Prowler security scanning role
      {
        name        = "prowler"
        description = "Prowler security scanning (read-only)"
        # No restrictions - can run from any branch/PR for security audits
        max_session_duration = 3600

        policy_arns = [
          "arn:aws:iam::aws:policy/ReadOnlyAccess",
          "arn:aws:iam::aws:policy/SecurityAudit"
        ]
      },

      # E2E testing role - for running Playwright tests against production
      {
        name                    = "e2e"
        description             = "E2E tests against production (S3 email access)"
        environment_restriction = "e2e-tests" # Only e2e-tests environment can assume
        max_session_duration    = 3600

        inline_policies = [
          {
            name = "s3-email-read"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "S3EmailRead"
                  Effect = "Allow"
                  Action = [
                    "s3:GetObject",
                    "s3:ListBucket"
                  ]
                  Resource = [
                    "arn:aws:s3:::dc34-email-*",
                    "arn:aws:s3:::dc34-email-*/*"
                  ]
                },
                {
                  Sid    = "SSMEmailBucketParam"
                  Effect = "Allow"
                  Action = ["ssm:GetParameter"]
                  Resource = [
                    "arn:aws:ssm:*:*:parameter/dc34/ses/s3/*/bucket_name"
                  ]
                }
              ]
            })
          }
        ]
      }
    ]
  }
}