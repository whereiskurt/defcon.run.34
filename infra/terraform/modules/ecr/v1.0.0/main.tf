data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Expand each repository across its list of regions
  # Creates one entry per repo per region
  expanded_repositories = flatten([
    for repo in var.ecr :
    [
      for region in repo.regions :
      {
        key                  = "${repo.name}-${region}"
        name                 = repo.name
        region               = region
        image_tag_mutability = repo.image_tag_mutability
        scan_on_push         = repo.scan_on_push
        encryption_type      = repo.encryption_type
        kms_key              = repo.kms_key
        lifecycle_policy     = repo.lifecycle_policy
      }
    ]
  ])

  # Filter repositories for the current region only
  region_repositories = [
    for repo in local.expanded_repositories :
    repo if repo.region == var.region.full
  ]

  # Create a map of repositories by name for this region
  repositories_map = {
    for repo in local.region_repositories :
    repo.name => {
      name                 = repo.name
      region               = repo.region
      image_tag_mutability = repo.image_tag_mutability
      scan_on_push         = repo.scan_on_push
      encryption_type      = repo.encryption_type
      kms_key              = repo.kms_key
      lifecycle_policy     = repo.lifecycle_policy
      # Full repository name with site label for uniqueness
      repository_name = "${var.site.label}-${repo.name}"
      # Repository URL for use in task definitions
      repository_url = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.name}.amazonaws.com/${var.site.label}-${repo.name}"
    }
  }

  # Default lifecycle policy JSON
  default_lifecycle_policy = {
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 30 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = {
          type = "expire"
        }
      }
    ]
  }
}

# ECR Repository
resource "aws_ecr_repository" "repository" {
  for_each = local.repositories_map

  name                 = each.value.repository_name
  image_tag_mutability = each.value.image_tag_mutability
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = each.value.scan_on_push
  }

  encryption_configuration {
    encryption_type = each.value.encryption_type
    kms_key         = each.value.encryption_type == "KMS" && each.value.kms_key != "" ? each.value.kms_key : null
  }

  tags = {
    Name     = each.value.repository_name
    RepoName = each.key
    Region   = var.region.label
    Site     = var.site.label
  }
}

# ECR Lifecycle Policy
resource "aws_ecr_lifecycle_policy" "policy" {
  for_each = {
    for name, repo in local.repositories_map :
    name => repo if repo.lifecycle_policy != null
  }

  repository = aws_ecr_repository.repository[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last ${each.value.lifecycle_policy.max_image_count} images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = each.value.lifecycle_policy.max_image_count
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ECR Repository Policy (allow pull from ECS tasks)
resource "aws_ecr_repository_policy" "policy" {
  for_each = local.repositories_map

  repository = aws_ecr_repository.repository[each.key].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowPullFromECS"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
      },
      {
        Sid    = "AllowPushPull"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
      }
    ]
  })
}
