locals {
  # Load service definitions from infra/services/
  ecs_auth_service = read_terragrunt_config("./services/auth/service.hcl")
  ecs_run_human_service = read_terragrunt_config("./services/run-human/service.hcl")

  site = {
    label         = "dc34"
    random_suffix = get_env("SGUID", "80a6b349")
    skip_regions  = []  # Set to ["ca-central-1"] to skip that region
  }

  dns = {
    zonename   = "defcon.run"
    subdomains = ["email", "run", "auth"]
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
      "auth.defcon.run"
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
    enabled  = false
    log_mode = "standard" # standard | realtime
  }

  cloudfront = {
    enabled = true

    # Domains that will be served by CloudFront
    # These will be combined with dns.zonename to create full domains
    # e.g., "run" becomes "auth.defcon.run"
    domains = ["auth", "run"]

    ##Map fronted domain "auth.defcon.run" to the ruleset called "auth"
    waf_rulesets = {
      "auth" = "auth"     # Use the 'api' ruleset from waf.hcl
      # "run"  = "default" # Use the 'default' ruleset from waf.hcl
    }

    # Regions that will provide ALB and S3 bucket origins
    # Each region will contribute:
    # - An ALB origin for /{region_label}/*
    # - An S3 bucket origin for /{region_label}/assets/*
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
      include_cookies = true
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
    tables  = concat(
      local.ecs_auth_service.locals.dynamodb.tables,
      local.ecs_run_human_service.locals.dynamodb.tables
    )
  }

  ecr = {
    enabled = true
    repositories = concat(
      local.ecs_auth_service.locals.ecr_repositories,
      local.ecs_run_human_service.locals.ecr_repositories
    )
  }

  ecs_tasks = {
    enabled = true
    tasks = [
      local.ecs_auth_service.locals.task,
      local.ecs_run_human_service.locals.task
    ]
  }

  ecs_services = {
    enabled = true
    services = [
      local.ecs_auth_service.locals.service,
      local.ecs_run_human_service.locals.service
    ]
  }

  user_uploads = {
    enabled = true
    buckets = concat(
      try(local.ecs_run_human_service.locals.user_uploads, [])
      # Future: local.ecs_run_gpx_service.locals.user_uploads
    )
  }

  upload_processors = {
    enabled = true
    processors = concat(
      try(local.ecs_run_human_service.locals.upload_processors, [])
      # Future: local.ecs_run_gpx_service.locals.upload_processors
    )
  }

  github_oidc = {
    enabled     = false
    github_org  = "whereiskurt"      # Your GitHub org/user
    github_repo = "defcon.run.34"    # Your repository name

    # Management account for cross-account Route53 access
    # Set this to your management account ID to get the trust policy output
    # After deploying, create the delegate role in the management account
    management_account_id = null  # e.g., "123456789012"

    roles = [
      # Terragrunt role - for infrastructure deployments
      # Equivalent to your local "terraform" profile + management profile
      {
        name                 = "terragrunt"
        description          = "Terragrunt infrastructure deployments"
        branch_restriction   = "main"  # Only main branch can assume this role
        max_session_duration = 3600

        # Full admin for now - scope down for production
        policy_arns = [
          "arn:aws:iam::aws:policy/AdministratorAccess"
        ]

        # Cross-account access to management account for Route53
        # Uncomment after creating the delegate role in management account:
        # cross_account_arns = [
        #   "arn:aws:iam::MGMT_ACCOUNT_ID:role/dc34-github-delegate"
        # ]
      },

      # Application role - for app deployments (ECR, S3, ECS)
      # Equivalent to your local "application" profile
      {
        name                   = "application"
        description            = "Application deployments (ECR, S3, ECS)"
        environment_restriction = "production"  # Only production environment
        max_session_duration   = 3600

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
        name               = "readonly"
        description        = "Read-only for PR plan previews"
        # No branch/environment restriction - all PRs can use this
        max_session_duration = 3600

        policy_arns = [
          "arn:aws:iam::aws:policy/ReadOnlyAccess"
        ]
      }
    ]
  }
}