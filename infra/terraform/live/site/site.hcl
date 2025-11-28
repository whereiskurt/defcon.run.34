locals {
  # Load service definitions from infra/services/
  ecs_auth_service = read_terragrunt_config("./services/auth/auth.hcl")

  site = {
    label         = "dc34"
    random_suffix = get_env("SGUID", "80a6b349")
    skip_regions  = ["ca-central-1"]  # Set to ["ca-central-1"] to skip that region

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
    # e.g., "run" becomes "run.defcon.run"
    domains = ["auth"]

    waf_rulesets = {
      "run"  = "default" # Use the 'default' ruleset from waf.hcl
      "auth" = "api"     # Use the 'api' ruleset from waf.hcl
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

    # CloudFront logging configuration
    logging = {
      enabled         = true
      include_cookies = true
    }

    # Price class for CloudFront distribution
    # Options: PriceClass_All, PriceClass_200, PriceClass_100
    price_class = "PriceClass_100"

  }

  dynamodb = {
    enabled = true
    tables  = [
      # Electro table with multi-region replication
      {
        table_name = "electro"
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
        table_name = "auth"
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
          }
        ]

        billing_mode     = "PAY_PER_REQUEST"
        hash_key         = "pk"
        range_key        = "sk"
        stream_enabled   = true
        stream_view_type = "NEW_AND_OLD_IMAGES"

        ttl_enabled        = true
        ttl_attribute_name = "ttl"
      }
    ]
  }

  ec2spots = {
    enabled = false # Set to true to enable EC2 spot instances
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

  ecr = {
    enabled = true # Set to false to disable ECR repositories
    # Repositories are aggregated from service definitions
    repositories = concat(
      local.ecs_auth_service.locals.ecr_repositories,
      # Add more service repositories here as needed:
      # local.other_service.locals.ecr_repositories,
    )
  }

  ecs_clusters = {
    enabled = true # Set to false to disable ECS clusters
    clusters = [
      # App cluster in us-east-1
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

  ecs_tasks = {
    enabled = true # Set to false to disable ECS tasks
    tasks = [
      local.ecs_auth_service.locals.task,
    ]
  }

  ecs_services = {
    enabled = true # Set to false to disable ECS services
    services = [
      local.ecs_auth_service.locals.service,
    ]
  }

  github_oidc = {
    enabled     = true
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