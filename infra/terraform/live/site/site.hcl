locals {
  # Load service definitions from infra/services/
  ecs_auth_service      = read_terragrunt_config("./services/run-auth/service.hcl")
  ecs_run_human_service = read_terragrunt_config("./services/run-human/service.hcl")
  ecs_cms_service       = read_terragrunt_config("./services/run-cms/service.hcl")
  ecs_gpx_service       = read_terragrunt_config("./services/run-gpx/service.hcl")

  site = {
    label         = "dc34"
    random_suffix = get_env("SGUID", "80a6b349")
    skip_regions  = ["ca-central-1", "ap-southeast-1"] # Remove "ap-southeast-1" to enable apse1 region after bootstrapping state bucket
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
      },
      {
        label = "apse1"
        full  = "ap-southeast-1"
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
        send_to = get_env("TF_VAR_FWD_EMAIL_TO_ADDRESS", "admin@example.com")
      },
      {
        match   = "kurt@run.defcon.run"
        send_to = get_env("TF_VAR_FWD_EMAIL_TO_ADDRESS", "admin@example.com")
      },
      {
        match   = "defcon.run"
        send_to = get_env("TF_VAR_FWD_EMAIL_TO_ADDRESS", "admin@example.com")
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
      },
      {
        label = "apse1"
        full  = "ap-southeast-1"
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
        enable_insights = true
        cluster_type    = "FARGATE"
      },
      {
        name            = "app"
        region          = "ca-central-1"
        enable_insights = true
        cluster_type    = "FARGATE"
      },
      {
        name            = "app"
        region          = "ap-southeast-1"
        enable_insights = true
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
          regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]

          lifecycle = {
            uploads_expire_days   = 0 # Keep GPX files indefinitely
            processed_expire_days = 0
            enable_versioning     = true
          }

          replication = {
            enabled = true
            replica_regions = [
              { label = "use1", full = "us-east-1" },
              { label = "cac1", full = "ca-central-1" },
              { label = "apse1", full = "ap-southeast-1" }
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
      },
      {
        label = "apse1"
        full  = "ap-southeast-1"
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

  # CloudTrail for IAM activity logging and policy generation
  # Records all API calls to enable least-privilege policy generation
  cloudtrail = {
    enabled = true

    # Multi-region trail captures activity across all regions
    multi_region = true

    # How long to retain logs (90 days recommended for policy analysis)
    log_retention_days = 90

    # Move logs to Glacier after N days (0 = disabled)
    # Set to 30+ for cost savings on long-term retention
    glacier_transition_days = 0

    # IAM Access Analyzer generates least-privilege policies from CloudTrail
    enable_access_analyzer = true

    # Athena enables SQL queries on CloudTrail logs
    enable_athena = true

    # KMS encryption for CloudTrail logs
    enable_kms_encryption = true

    # Security + cost alerts via email
    enable_alerts = true
    alert_email   = get_env("TF_VAR_ADMIN_EMAIL", "admin@example.com")

    # GitHub OIDC roles to monitor (all roles by default)
    monitor_roles = [
      "terragrunt",
      "application",
      "readonly",
      "prowler",
      "e2e",
      "release",
      "deploy"
    ]
  }

  github_oidc = {
    enabled     = true
    github_org  = get_env("TF_VAR_GITHUB_ORG", "your-github-org")
    github_repo = "defcon.run.34"

    # Management account for cross-account Route53 access
    # Set this to your management account ID to get the trust policy output
    # After deploying, create the delegate role in the management account
    management_account_id = get_env("TF_VAR_MANAGEMENT_ACCOUNT_ID", "123456789012")

    # EC2 instance profile for self-hosted GitHub runners
    # Enables SSM access for debugging and includes ECR read access
    ec2_runner_instance_profile = {
      enabled = true
      name    = "github-runner"
    }

    roles = [
      # Terragrunt role - for infrastructure deployments
      # Equivalent to your local "terraform" profile + management profile
      # Policy generated via iamlive from actual terragrunt apply
      {
        name                    = "terragrunt"
        description             = "Terragrunt infrastructure deployments"
        environment_restriction = "terraform-apply" # Only terraform-apply environment can assume this role
        max_session_duration    = 3600

        policy_arns     = []
        inline_policies = []

        # Customer-managed policies (6KB each) - avoids 10KB inline policy limit
        managed_policies = [
          {
            name = "tg-core"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid      = "TerraformState"
                  Effect   = "Allow"
                  Action   = ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket", "s3:ListMultipartUploadParts", "s3:PutObject"]
                  Resource = ["arn:aws:dynamodb:*:*:table/tf-defcon-run-*", "arn:aws:s3:::tf-defcon-run-*", "arn:aws:s3:::tf-defcon-run-*/*"]
                },
                {
                  Sid      = "Core"
                  Effect   = "Allow"
                  Action   = ["kms:Decrypt", "kms:DescribeKey", "sts:GetCallerIdentity"]
                  Resource = "*"
                },
                {
                  Sid      = "DynamoDB"
                  Effect   = "Allow"
                  Action   = ["dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive", "dynamodb:ListTagsOfResource", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:UpdateContinuousBackups", "dynamodb:UpdateTable", "dynamodb:UpdateTimeToLive"]
                  Resource = "*"
                },
                {
                  Sid      = "IAM"
                  Effect   = "Allow"
                  Action   = ["iam:*"]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "tg-compute"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid      = "EC2"
                  Effect   = "Allow"
                  Action   = ["ec2:AllocateAddress", "ec2:AssociateRouteTable", "ec2:AttachInternetGateway", "ec2:AuthorizeSecurityGroup*", "ec2:Create*", "ec2:Delete*", "ec2:Describe*", "ec2:DetachInternetGateway", "ec2:Disassociate*", "ec2:GetManagedPrefixListEntries", "ec2:Modify*", "ec2:ReleaseAddress", "ec2:RevokeSecurityGroupEgress"]
                  Resource = "*"
                },
                {
                  Sid      = "ECS"
                  Effect   = "Allow"
                  Action   = ["ecs:*"]
                  Resource = "*"
                },
                {
                  Sid      = "ECR"
                  Effect   = "Allow"
                  Action   = ["ecr:*"]
                  Resource = "*"
                },
                {
                  Sid      = "ELB"
                  Effect   = "Allow"
                  Action   = ["elasticloadbalancing:*"]
                  Resource = "*"
                },
                {
                  Sid      = "Lambda"
                  Effect   = "Allow"
                  Action   = ["lambda:*"]
                  Resource = "*"
                },
                {
                  Sid      = "AutoScaling"
                  Effect   = "Allow"
                  Action   = ["application-autoscaling:*"]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "tg-storage"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid      = "S3"
                  Effect   = "Allow"
                  Action   = ["s3:CreateBucket", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteReplicationConfiguration", "s3:Get*", "s3:HeadBucket", "s3:List*", "s3:PutBucket*", "s3:PutEncryptionConfiguration", "s3:PutLifecycleConfiguration", "s3:PutReplicationConfiguration", "s3:TagResource", "s3:UntagResource"]
                  Resource = "*"
                },
                {
                  Sid      = "CloudWatch"
                  Effect   = "Allow"
                  Action   = ["cloudwatch:*", "logs:*"]
                  Resource = "*"
                },
                {
                  Sid      = "SSM"
                  Effect   = "Allow"
                  Action   = ["ssm:*"]
                  Resource = "*"
                },
                {
                  Sid      = "SNS"
                  Effect   = "Allow"
                  Action   = ["sns:*"]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "tg-network"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid      = "CloudFront"
                  Effect   = "Allow"
                  Action   = ["cloudfront:*"]
                  Resource = "*"
                },
                {
                  Sid      = "Route53"
                  Effect   = "Allow"
                  Action   = ["route53:*"]
                  Resource = "*"
                },
                {
                  Sid      = "ACM"
                  Effect   = "Allow"
                  Action   = ["acm:*"]
                  Resource = "*"
                },
                {
                  Sid      = "WAF"
                  Effect   = "Allow"
                  Action   = ["wafv2:*"]
                  Resource = "*"
                },
                {
                  Sid      = "ServiceDiscovery"
                  Effect   = "Allow"
                  Action   = ["servicediscovery:*"]
                  Resource = "*"
                },
                {
                  Sid      = "Analytics"
                  Effect   = "Allow"
                  Action   = ["access-analyzer:*", "athena:*", "cloudtrail:*", "events:*", "glue:*"]
                  Resource = "*"
                },
                {
                  Sid      = "SES"
                  Effect   = "Allow"
                  Action   = ["ses:*"]
                  Resource = "*"
                }
              ]
            })
          }
        ]

        # Cross-account access to management account for Route53
        cross_account_arns = [
          "arn:aws:iam::${get_env("TF_VAR_MANAGEMENT_ACCOUNT_ID", "000000000000")}:role/dc34-github-delegate"
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
                    "arn:aws:s3:::dc34-*/*",
                    "arn:aws:s3:::cf-assets-*",
                    "arn:aws:s3:::cf-assets-*/*"
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
                    "arn:aws:kms:us-east-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}",
                    "arn:aws:kms:ca-central-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}"
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
                    "arn:aws:dynamodb:us-east-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:table/tf-defcon-run-use1-*",
                    "arn:aws:dynamodb:ca-central-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:table/tf-defcon-run-cac1-*"
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
          "arn:aws:iam::${get_env("TF_VAR_MANAGEMENT_ACCOUNT_ID", "000000000000")}:role/dc34-github-delegate"
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
                    "arn:aws:s3:::ses-inbox-dc34-*",
                    "arn:aws:s3:::ses-inbox-dc34-*/*"
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
      },

      # Release role - for GitHub Actions release workflow
      # Used by release.yml to build and push Docker images, sync assets to S3
      {
        name        = "release"
        description = "Release workflow (ECR push, S3 assets, CloudFront invalidation)"
        # No branch restriction - release workflow can run from any branch
        # The workflow creates release/* branches and merges PRs
        max_session_duration = 7200 # 2 hours for long builds

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
                    "arn:aws:s3:::dc34-*/*",
                    "arn:aws:s3:::cf-assets-*",
                    "arn:aws:s3:::cf-assets-*/*"
                  ]
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
          },
          {
            name = "cloudfront-invalidate"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "CloudFrontInvalidate"
                  Effect = "Allow"
                  Action = [
                    "cloudfront:CreateInvalidation",
                    "cloudfront:GetInvalidation",
                    "cloudfront:ListDistributions"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "sts-identity"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "STSIdentity"
                  Effect = "Allow"
                  Action = [
                    "sts:GetCallerIdentity"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "ec2-runner"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "EC2Describe"
                  Effect = "Allow"
                  Action = [
                    "ec2:DescribeSubnets",
                    "ec2:DescribeSecurityGroups",
                    "ec2:DescribeInstances",
                    "ec2:DescribeInstanceStatus",
                    "ec2:DescribeImages"
                  ]
                  Resource = "*"
                },
                {
                  Sid    = "EC2RunInstances"
                  Effect = "Allow"
                  Action = [
                    "ec2:RunInstances"
                  ]
                  Resource = "*"
                },
                {
                  Sid    = "EC2CreateTagsOnLaunch"
                  Effect = "Allow"
                  Action = [
                    "ec2:CreateTags"
                  ]
                  Resource = "*"
                  Condition = {
                    StringEquals = {
                      "ec2:CreateAction" = "RunInstances"
                    }
                  }
                },
                {
                  Sid    = "EC2CreateTagsOnExisting"
                  Effect = "Allow"
                  Action = [
                    "ec2:CreateTags"
                  ]
                  Resource = "*"
                  Condition = {
                    StringEquals = {
                      "ec2:ResourceTag/Project" = "defcon.run.34"
                    }
                  }
                },
                {
                  Sid    = "EC2SpotPermissions"
                  Effect = "Allow"
                  Action = [
                    "ec2:DescribeSpotPriceHistory",
                    "ec2:RequestSpotInstances",
                    "ec2:CancelSpotInstanceRequests",
                    "ec2:DescribeSpotInstanceRequests"
                  ]
                  Resource = "*"
                },
                {
                  Sid    = "EC2TerminateTagged"
                  Effect = "Allow"
                  Action = [
                    "ec2:TerminateInstances"
                  ]
                  Resource = "*"
                  Condition = {
                    StringEquals = {
                      "ec2:ResourceTag/Project" = "defcon.run.34"
                    }
                  }
                },
                {
                  Sid    = "IAMPassRole"
                  Effect = "Allow"
                  Action = "iam:PassRole"
                  Resource = "arn:aws:iam::*:role/*github-runner*"
                }
              ]
            })
          }
        ]
      },

      # Deploy role - for GitHub Actions deploy and rollback workflows
      # Used by deploy.yml and rollback.yml to update ECS services via terragrunt
      {
        name                 = "deploy"
        description          = "Deploy workflow (ECS updates via terragrunt)"
        branch_restriction   = "main" # Only main branch can deploy
        max_session_duration = 3600

        inline_policies = [
          {
            name = "terraform-state"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
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
                    "arn:aws:s3:::tf-defcon-run-*",
                    "arn:aws:s3:::tf-defcon-run-*/*"
                  ]
                },
                {
                  Sid    = "DynamoDBStateLock"
                  Effect = "Allow"
                  Action = [
                    "dynamodb:PutItem",
                    "dynamodb:GetItem",
                    "dynamodb:DeleteItem"
                  ]
                  Resource = [
                    "arn:aws:dynamodb:*:*:table/tf-defcon-run-*"
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
                  Sid    = "ECSFullDeploy"
                  Effect = "Allow"
                  Action = [
                    "ecs:RegisterTaskDefinition",
                    "ecs:DeregisterTaskDefinition",
                    "ecs:DescribeTaskDefinition",
                    "ecs:ListTaskDefinitions",
                    "ecs:UpdateService",
                    "ecs:DescribeServices",
                    "ecs:DescribeClusters",
                    "ecs:ListServices",
                    "ecs:ListClusters"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "iam-pass-role"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "PassTaskRole"
                  Effect = "Allow"
                  Action = "iam:PassRole"
                  Resource = [
                    "arn:aws:iam::*:role/dc34-*-task-*",
                    "arn:aws:iam::*:role/dc34-*-execution-*"
                  ]
                },
                {
                  Sid    = "GetRole"
                  Effect = "Allow"
                  Action = [
                    "iam:GetRole"
                  ]
                  Resource = "arn:aws:iam::*:role/dc34-*"
                }
              ]
            })
          },
          {
            name = "ecr-read"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "ECRRead"
                  Effect = "Allow"
                  Action = [
                    "ecr:GetAuthorizationToken",
                    "ecr:DescribeImages",
                    "ecr:DescribeRepositories",
                    "ecr:ListImages",
                    "ecr:BatchGetImage",
                    "ecr:GetDownloadUrlForLayer"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "cloudfront-invalidate"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "CloudFrontInvalidate"
                  Effect = "Allow"
                  Action = [
                    "cloudfront:CreateInvalidation",
                    "cloudfront:GetInvalidation",
                    "cloudfront:ListDistributions"
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
          },
          {
            name = "logs-read"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "LogsRead"
                  Effect = "Allow"
                  Action = [
                    "logs:DescribeLogGroups",
                    "logs:DescribeLogStreams"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
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
                    "arn:aws:kms:us-east-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}",
                    "arn:aws:kms:ca-central-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}"
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