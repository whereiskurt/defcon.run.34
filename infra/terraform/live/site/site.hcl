locals {

  site = {
    label            = "dc34"
    github_repo_name = "defcon.run.34"
    tf_state_prefix  = "tf-dc34"
    random_suffix    = get_env("SGUID", "80a6b349")
    skip_regions     = ["ap-southeast-1", "ca-central-1"]
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

  dns = {
    zonename         = "defcon.run"
    subdomains       = ["email", "run", "auth", "cms", "gpx", "flash", "mqtt"]
    ttl              = 300
  }

  # URL configuration for services
  # These values are used to generate environment variables for containers
  # and can be referenced in service.hcl files
  urls = {
    # Service subdomains (combined with dns.zonename to form full domains)
    # e.g., "auth" + "defcon.run" = "auth.defcon.run"
    subdomains = {
      "auth" = "auth"
      "cms" = "cms"
      "flash" = "flash"
      "gpx" = "gpx"
      "run" = "run"
    }

    # Local development ports (for .env.local files and development defaults)
    local_ports = {
      auth = 3002
      cms = 1337
      flash = 3004
      gpx = 3003
      run = 3001
    }

    # Service discovery namespace pattern (used for internal container communication)
    # {{REGION_LABEL}} is substituted at deployment time (e.g., use1, cac1)
    service_namespace = "app-{{REGION_LABEL}}-${local.site.label}.local"
  }

  # Load service definitions from infra/services/
  service_conf = {
    auth      = read_terragrunt_config("./services/run.auth/service.hcl")
    run_human = read_terragrunt_config("./services/run.human/service.hcl")
    cms       = read_terragrunt_config("./services/run.cms/service.hcl")
    gpx       = read_terragrunt_config("./services/run.gpx/service.hcl")
    flash     = read_terragrunt_config("./services/run.flash/service.hcl")
    mqtt      = read_terragrunt_config("./services/run.mqtt/service.hcl")
  }

  email = {
    enabled        = true
    primary_region = "us-east-1"
    zonenames      = [for sub in ["email", "run", "auth"] : "${sub}.${local.dns.zonename}"]
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

    smtp_iam_users = [for sub in ["run", "auth", "cms"] : "${sub}.${local.dns.zonename}"]

    fwd_rules = concat(
      [
        {
          match   = "admin@${local.dns.zonename}"
          send_to = get_env("TF_VAR_FWD_EMAIL_TO_ADDRESS", "admin@example.com")
        },
        {
          match   = "no-reply@run.${local.dns.zonename}"
          send_to = get_env("TF_VAR_FWD_EMAIL_TO_ADDRESS", "no-reply@run.example.com")
        },
      ],
      # Only include catch-all rule if TF_VAR_FWD_EMAIL_TO_ADDRESS is set
      get_env("TF_VAR_FWD_EMAIL_TO_ADDRESS", "") != "" ? [
        {
          match   = local.dns.zonename
          send_to = get_env("TF_VAR_FWD_EMAIL_TO_ADDRESS", "")
        }
      ] : []
    )
  }

  waf = {
    enabled  = false
    log_mode = "standard" # standard | realtime
  }

  cloudfront = {
    enabled = true

    # Domains that will be served by CloudFront
    # These will be combined with dns.zonename to create full domains
    # e.g., "run" becomes "run.<dns.zonename>"
    domains = ["auth", "run", "cms", "gpx", "flash"]

    ## Map fronted domain "auth.<dns.zonename>" to the ruleset called "auth"
    waf_rulesets = {
      "auth" = "auth"
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
        regions                = ["us-east-1", "ca-central-1", "ap-southeast-1"]
        zone_name              = "run.${local.dns.zonename}"
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
        regions         = ["us-east-1", "ca-central-1", "ap-southeast-1"]
        enable_insights = false
        cluster_type    = "FARGATE"
        # Per-region overrides (optional) - merge into base config for specific regions
        # region_overrides = {
        #   "ap-southeast-1" = {
        #     enable_insights = false
        #   }
        # }
      }
    ]
  }

  dynamodb = {
    enabled = true
    tables = concat(
      local.service_conf.auth.locals.dynamodb.tables,
      local.service_conf.run_human.locals.dynamodb.tables,
      local.service_conf.gpx.locals.dynamodb.tables
    )
  }

  ecr = {
    enabled = true
    repositories = concat(
      local.service_conf.auth.locals.ecr_repositories,
      local.service_conf.run_human.locals.ecr_repositories,
      local.service_conf.cms.locals.ecr_repositories,
      local.service_conf.gpx.locals.ecr_repositories,
      local.service_conf.flash.locals.ecr_repositories,
      local.service_conf.mqtt.locals.ecr_repositories,
      local.waffaw.enabled ? [{ name = "waffaw", regions = ["us-east-1", "ca-central-1", "ap-southeast-1"], image_tag_mutability = "IMMUTABLE" }] : []
    )
  }

  ecs_tasks = {
    enabled        = true
    enable_logging = false
    tasks = [
      local.service_conf.auth.locals.task,
      local.service_conf.run_human.locals.task,
      local.service_conf.cms.locals.task_master,
      local.service_conf.cms.locals.task_worker,
      local.service_conf.gpx.locals.task,
      local.service_conf.flash.locals.task,
      local.service_conf.mqtt.locals.task
    ]
  }

  ecs_services = {
    enabled = true
    services = [
      local.service_conf.auth.locals.service,
      local.service_conf.run_human.locals.service,
      local.service_conf.cms.locals.service_master,
      local.service_conf.cms.locals.service_worker,
      local.service_conf.gpx.locals.service,
      local.service_conf.flash.locals.service,
      local.service_conf.mqtt.locals.service
    ]
  }

  user_uploads = {
    enabled = true
    buckets = concat(
      try(local.service_conf.run_human.locals.user_uploads, []),
      try(local.service_conf.cms.locals.cms_storage, []),
      try(local.service_conf.gpx.locals.gpx_storage, [])
    )
  }

  upload_processors = {
    enabled = true
    processors = concat(
      try(local.service_conf.run_human.locals.upload_processors, [])
      # Future: local.service_conf.gpx.locals.upload_processors
    )
  }

  waffaw = {
    enabled         = false
    ec2_count       = 0
    ec2_max_count   = 10
    ec2_instance_type = "t3.medium"
    ec2_use_spot    = true
    ec2_multi_eni   = false
    ecs_desired_count = 0
    ecs_use_spot    = true
    ecs_task_cpu    = 1024
    ecs_task_memory = 2048
    image_uri       = "dc34-waffaw:1.0.26"
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
      altcha = {
        description = "ALTCHA proof-of-work secret"
        keys        = ["secret"]
      }
      discord = {
        description = "Discord OAuth credentials"
        keys        = ["client_id", "client_secret"]
      }
      flash = {
        description = "Flash tool OIDC client credentials"
        keys        = ["client_id", "client_secret"]
      }
      github = {
        description = "GitHub OAuth credentials"
        keys        = ["client_id", "client_secret"]
      }
      gpxstudio = {
        description = "GPX Studio OIDC client credentials"
        keys        = ["client_id", "client_secret"]
      }
      jwt = {
        description = "JWT signing secrets"
        keys        = ["secret", "internal_secret"]
      }
      mapbox = {
        description = "Mapbox API tokens"
        keys        = ["public_token"]
        global      = true
      }
      oidc = {
        description = "OIDC cookie encryption keys"
        keys        = ["cookie_keys"]
      }
      origin_verify = {
        description = "CloudFront origin verification secret for multi-region routing"
        keys        = ["secret"]
      }
      runhuman = {
        description = "RunHuman OIDC client credentials"
        keys        = ["client_id", "client_secret"]
      }
      strapi = {
        description = "Strapi CMS secrets"
        keys        = ["admin_email", "admin_password", "admin_jwt_secret", "api_token_salt", "app_keys", "transfer_token_salt", "jwt_secret", "oidc_client_id", "oidc_client_secret"]
      }
      strava = {
        description = "Strava OAuth credentials"
        keys        = ["client_id", "client_secret"]
      }
      mqtt = {
        description = "MQTT broker and meshtk secrets"
        keys        = ["meshtk-proxy-password", "meshobserv-password", "ghosts-password", "max-connections", "s3-log-interval", "channel-psk", "ghost-start-delay"]
      }
    }
  }

  # CloudTrail for IAM activity logging and policy generation
  # Records all API calls to enable least-privilege policy generation
  cloudtrail = {
    enabled = false

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
      "deploy",
    ]
  }

  # Extracted to avoid self-reference within github_oidc block
  github_oidc_delegate_role_name = "${local.site.label}-github-delegate" # "dc34-github-delegate"

  github_oidc = {
    enabled            = true
    github_org         = get_env("TF_VAR_GITHUB_ORG", "your-github-org")
    github_repo        = local.site.github_repo_name
    delegate_role_name = local.github_oidc_delegate_role_name

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
                  Resource = ["arn:aws:dynamodb:*:*:table/${local.site.tf_state_prefix}-*", "arn:aws:s3:::${local.site.tf_state_prefix}-*", "arn:aws:s3:::${local.site.tf_state_prefix}-*/*"]
                },
                {
                  Sid      = "Core"
                  Effect   = "Allow"
                  Action   = ["kms:*", "sts:GetCallerIdentity"]
                  Resource = "*"
                },
                {
                  Sid      = "DynamoDB"
                  Effect   = "Allow"
                  Action   = ["dynamodb:*"]
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
          "arn:aws:iam::${get_env("TF_VAR_MANAGEMENT_ACCOUNT_ID", "000000000000")}:role/${local.github_oidc_delegate_role_name}"
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
                  Resource = "arn:aws:ecr:*:*:repository/${local.site.label}-*"
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
                    "arn:aws:s3:::${local.site.label}-*",
                    "arn:aws:s3:::${local.site.label}-*/*",
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
                  Resource = "arn:aws:ssm:*:*:parameter/${local.site.label}/*"
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
            # SOPS decrypt covers the SOPS multi-region CMK plus any per-purpose
            # SSM CMKs the readonly PR-plan role must decrypt at plan time to
            # read SecureString parameters. Extend via TF_VAR_SSM_KMS_KEY_ARNS
            # (comma-separated ARN list) — env.sops.sh discovers the aliases
            # and populates it. Any dc34-scoped SSM CMK NOT in this list will
            # cause the readonly role to 400 with AccessDeniedException on
            # kms:Decrypt during Terragrunt Plan on release PRs.
            name = "kms-sops-decrypt"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "SOPSAndSSMDecrypt"
                  Effect = "Allow"
                  Action = [
                    "kms:Decrypt",
                    "kms:DescribeKey"
                  ]
                  Resource = concat(
                    [
                      "arn:aws:kms:us-east-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}",
                      "arn:aws:kms:ca-central-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}",
                      "arn:aws:kms:ap-southeast-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}"
                    ],
                    compact(split(",", get_env("TF_VAR_SSM_KMS_KEY_ARNS", "")))
                  )
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
                    "arn:aws:dynamodb:us-east-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:table/${local.site.tf_state_prefix}-use1-*",
                    "arn:aws:dynamodb:ca-central-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:table/${local.site.tf_state_prefix}-cac1-*"
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
                    "arn:aws:s3:::${local.site.tf_state_prefix}-use1-*",
                    "arn:aws:s3:::${local.site.tf_state_prefix}-use1-*/*",
                    "arn:aws:s3:::${local.site.tf_state_prefix}-cac1-*",
                    "arn:aws:s3:::${local.site.tf_state_prefix}-cac1-*/*"
                  ]
                }
              ]
            })
          }
        ]

        # Cross-account access to management account for Route53
        cross_account_arns = [
          "arn:aws:iam::${get_env("TF_VAR_MANAGEMENT_ACCOUNT_ID", "000000000000")}:role/${local.github_oidc_delegate_role_name}"
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
                    "arn:aws:s3:::ses-inbox-${local.site.label}-*",
                    "arn:aws:s3:::ses-inbox-${local.site.label}-*/*"
                  ]
                },
                {
                  Sid    = "SSMEmailBucketParam"
                  Effect = "Allow"
                  Action = ["ssm:GetParameter"]
                  Resource = [
                    "arn:aws:ssm:*:*:parameter/${local.site.label}/ses/s3/*/bucket_name"
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
                  Resource = "arn:aws:ecr:*:*:repository/${local.site.label}-*"
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
                    "arn:aws:s3:::${local.site.label}-*",
                    "arn:aws:s3:::${local.site.label}-*/*",
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
                  Resource = "arn:aws:ssm:*:*:parameter/${local.site.label}/*"
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
                      "ec2:ResourceTag/Project" = local.site.github_repo_name
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
                      "ec2:ResourceTag/Project" = local.site.github_repo_name
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
          },
          {
            # See the same-named policy on the readonly role above for the
            # TF_VAR_SSM_KMS_KEY_ARNS extension pattern.
            name = "kms-sops-decrypt"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "SOPSAndSSMDecrypt"
                  Effect = "Allow"
                  Action = [
                    "kms:Decrypt",
                    "kms:DescribeKey"
                  ]
                  Resource = concat(
                    [
                      "arn:aws:kms:us-east-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}",
                      "arn:aws:kms:ca-central-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}",
                      "arn:aws:kms:ap-southeast-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}"
                    ],
                    compact(split(",", get_env("TF_VAR_SSM_KMS_KEY_ARNS", "")))
                  )
                }
              ]
            })
          },
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
                    "arn:aws:s3:::${local.site.tf_state_prefix}-*",
                    "arn:aws:s3:::${local.site.tf_state_prefix}-*/*"
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
                    "arn:aws:dynamodb:*:*:table/${local.site.tf_state_prefix}-*"
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
                    "ecs:ListClusters",
                    "ecs:TagResource",
                    "ecs:UntagResource",
                    "ecs:ListTagsForResource"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "iam-ecs-roles"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "PassTaskRole"
                  Effect = "Allow"
                  Action = "iam:PassRole"
                  Resource = [
                    "arn:aws:iam::*:role/run-*-${local.site.label}-task-role",
                    "arn:aws:iam::*:role/run-*-${local.site.label}-execution-role",
                    "arn:aws:iam::*:role/ecs-task-role-*-${local.site.label}-*",
                    "arn:aws:iam::*:role/ecs-execution-role-*-${local.site.label}-*"
                  ]
                },
                {
                  Sid    = "IAMReadRoles"
                  Effect = "Allow"
                  Action = [
                    "iam:GetRole",
                    "iam:ListRolePolicies",
                    "iam:GetRolePolicy",
                    "iam:ListAttachedRolePolicies",
                    "iam:ListInstanceProfilesForRole"
                  ]
                  Resource = [
                    "arn:aws:iam::*:role/run-*-${local.site.label}-*",
                    "arn:aws:iam::*:role/ecs-*-role-*-${local.site.label}-*",
                    "arn:aws:iam::*:role/${local.site.label}-*"
                  ]
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
            name = "service-discovery"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "ServiceDiscoveryRead"
                  Effect = "Allow"
                  Action = [
                    "servicediscovery:GetService",
                    "servicediscovery:GetNamespace",
                    "servicediscovery:ListServices",
                    "servicediscovery:ListNamespaces",
                    "servicediscovery:ListTagsForResource"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "elb-read"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "ELBRead"
                  Effect = "Allow"
                  Action = [
                    "elasticloadbalancing:DescribeTargetGroups",
                    "elasticloadbalancing:DescribeTargetGroupAttributes",
                    "elasticloadbalancing:DescribeLoadBalancers",
                    "elasticloadbalancing:DescribeLoadBalancerAttributes",
                    "elasticloadbalancing:DescribeListeners",
                    "elasticloadbalancing:DescribeListenerAttributes",
                    "elasticloadbalancing:DescribeRules",
                    "elasticloadbalancing:DescribeTargetHealth",
                    "elasticloadbalancing:DescribeTags"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "autoscaling-read"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "AutoScalingRead"
                  Effect = "Allow"
                  Action = [
                    "application-autoscaling:DescribeScalableTargets",
                    "application-autoscaling:DescribeScalingPolicies",
                    "application-autoscaling:DescribeScheduledActions",
                    "application-autoscaling:ListTagsForResource"
                  ]
                  Resource = "*"
                }
              ]
            })
          },
          {
            name = "cloudwatch-read"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "CloudWatchRead"
                  Effect = "Allow"
                  Action = [
                    "cloudwatch:DescribeAlarms",
                    "cloudwatch:ListTagsForResource"
                  ]
                  Resource = "*"
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
                    "arn:aws:s3:::${local.site.tf_state_prefix}-*",
                    "arn:aws:s3:::${local.site.tf_state_prefix}-*/*"
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
                    "arn:aws:dynamodb:*:*:table/${local.site.tf_state_prefix}-*"
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
                    "arn:aws:iam::*:role/${local.site.label}-*-task-*",
                    "arn:aws:iam::*:role/${local.site.label}-*-execution-*"
                  ]
                },
                {
                  Sid    = "GetRole"
                  Effect = "Allow"
                  Action = [
                    "iam:GetRole"
                  ]
                  Resource = "arn:aws:iam::*:role/${local.site.label}-*"
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
                  Resource = "arn:aws:ssm:*:*:parameter/${local.site.label}/*"
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
            # See the same-named policy on the readonly role above for the
            # TF_VAR_SSM_KMS_KEY_ARNS extension pattern.
            name = "kms-sops-decrypt"
            policy = jsonencode({
              Version = "2012-10-17"
              Statement = [
                {
                  Sid    = "SOPSAndSSMDecrypt"
                  Effect = "Allow"
                  Action = [
                    "kms:Decrypt",
                    "kms:DescribeKey"
                  ]
                  Resource = concat(
                    [
                      "arn:aws:kms:us-east-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}",
                      "arn:aws:kms:ca-central-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}",
                      "arn:aws:kms:ap-southeast-1:${get_env("TF_VAR_APPLICATION_ACCOUNT_ID", "000000000000")}:key/${get_env("TF_VAR_SOPS_KMS_KEY_ID", "mrk-00000000000000000000000000000000")}"
                    ],
                    compact(split(",", get_env("TF_VAR_SSM_KMS_KEY_ARNS", "")))
                  )
                }
              ]
            })
          }
        ]
      }
    ]
  }
}
