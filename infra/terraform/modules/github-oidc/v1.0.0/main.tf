data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  # Build role configurations from the roles list
  roles_map = {
    for role in var.github_oidc.roles :
    role.name => {
      name                 = role.name
      description          = role.description
      policy_arns          = role.policy_arns
      inline_policies      = role.inline_policies
      managed_policies     = role.managed_policies
      max_session_duration = role.max_session_duration
      cross_account_arns   = role.cross_account_arns

      # Build the subject claim pattern based on restrictions
      subject_pattern = role.branch_restriction != null ? (
        "repo:${var.github_oidc.github_org}/${var.github_oidc.github_repo}:ref:refs/heads/${role.branch_restriction}"
        ) : role.environment_restriction != null ? (
        "repo:${var.github_oidc.github_org}/${var.github_oidc.github_repo}:environment:${role.environment_restriction}"
        ) : (
        "repo:${var.github_oidc.github_org}/${var.github_oidc.github_repo}:*"
      )
    }
  }

  # Build cross-account assume role policies for roles that need them
  cross_account_policies = {
    for role_name, role in local.roles_map :
    role_name => role if length(role.cross_account_arns) > 0
  }
}

# GitHub OIDC Provider - one per AWS account
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"]

  tags = {
    Name      = "${var.site.label}-github-oidc"
    Site      = var.site.label
    ManagedBy = "Terragrunt"
  }
}

# IAM Roles for GitHub Actions
resource "aws_iam_role" "github_role" {
  for_each = local.roles_map

  name                 = "${var.site.label}-github-${each.key}"
  description          = each.value.description
  max_session_duration = each.value.max_session_duration

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = each.value.subject_pattern
          }
        }
      }
    ]
  })

  tags = {
    Name        = "${var.site.label}-github-${each.key}"
    Site        = var.site.label
    GitHubOrg   = var.github_oidc.github_org
    GitHubRepo  = var.github_oidc.github_repo
    ManagedBy   = "Terragrunt"
  }
}

# Attach managed policies to roles
resource "aws_iam_role_policy_attachment" "managed_policies" {
  for_each = {
    for pair in flatten([
      for role_name, role in local.roles_map : [
        for policy_arn in role.policy_arns : {
          key        = "${role_name}-${replace(policy_arn, "/[^a-zA-Z0-9]/", "-")}"
          role_name  = role_name
          policy_arn = policy_arn
        }
      ]
    ]) : pair.key => pair
  }

  role       = aws_iam_role.github_role[each.value.role_name].name
  policy_arn = each.value.policy_arn
}

# Inline policies for roles (10KB combined limit per role)
resource "aws_iam_role_policy" "inline_policies" {
  for_each = {
    for pair in flatten([
      for role_name, role in local.roles_map : [
        for policy in role.inline_policies : {
          key         = "${role_name}-${policy.name}"
          role_name   = role_name
          policy_name = policy.name
          policy      = policy.policy
        }
      ]
    ]) : pair.key => pair
  }

  name   = each.value.policy_name
  role   = aws_iam_role.github_role[each.value.role_name].id
  policy = each.value.policy
}

# Customer-managed policies (6KB each, up to 20 per role)
# Use this when inline_policies exceed 10KB limit
resource "aws_iam_policy" "managed_policies" {
  for_each = {
    for pair in flatten([
      for role_name, role in local.roles_map : [
        for policy in role.managed_policies : {
          key         = "${role_name}-${policy.name}"
          role_name   = role_name
          policy_name = policy.name
          policy      = policy.policy
        }
      ]
    ]) : pair.key => pair
  }

  name        = "${var.site.label}-github-${each.value.role_name}-${each.value.policy_name}"
  description = "Managed policy for ${var.site.label}-github-${each.value.role_name}"
  policy      = each.value.policy

  tags = {
    Name      = "${var.site.label}-github-${each.value.role_name}-${each.value.policy_name}"
    Site      = var.site.label
    Role      = each.value.role_name
    ManagedBy = "Terragrunt"
  }
}

# Attach customer-managed policies to roles
resource "aws_iam_role_policy_attachment" "managed_policy_attachments" {
  for_each = {
    for pair in flatten([
      for role_name, role in local.roles_map : [
        for policy in role.managed_policies : {
          key        = "${role_name}-${policy.name}"
          role_name  = role_name
          policy_name = policy.name
        }
      ]
    ]) : pair.key => pair
  }

  role       = aws_iam_role.github_role[each.value.role_name].name
  policy_arn = aws_iam_policy.managed_policies[each.key].arn
}

# Cross-account assume role policies
# Allows roles to assume roles in other AWS accounts (e.g., management account for Route53)
resource "aws_iam_role_policy" "cross_account_assume" {
  for_each = local.cross_account_policies

  name = "cross-account-assume"
  role = aws_iam_role.github_role[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AssumeRoleInOtherAccounts"
        Effect = "Allow"
        Action = "sts:AssumeRole"
        Resource = each.value.cross_account_arns
      }
    ]
  })
}

# =============================================================================
# EC2 Runner Instance Profile
# Creates an IAM role and instance profile for self-hosted GitHub runners
# Includes SSM access for remote debugging
# =============================================================================

resource "aws_iam_role" "ec2_runner" {
  count = var.github_oidc.ec2_runner_instance_profile.enabled ? 1 : 0

  name        = "${var.site.label}-${var.github_oidc.ec2_runner_instance_profile.name}"
  description = "IAM role for GitHub Actions self-hosted EC2 runners"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name      = "${var.site.label}-${var.github_oidc.ec2_runner_instance_profile.name}"
    Site      = var.site.label
    Purpose   = "github-runner"
    ManagedBy = "Terragrunt"
  }
}

# Attach SSM managed policy for remote access
resource "aws_iam_role_policy_attachment" "ec2_runner_ssm" {
  count = var.github_oidc.ec2_runner_instance_profile.enabled ? 1 : 0

  role       = aws_iam_role.ec2_runner[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Attach ECR read-only for pulling images (useful for build runners)
resource "aws_iam_role_policy_attachment" "ec2_runner_ecr" {
  count = var.github_oidc.ec2_runner_instance_profile.enabled ? 1 : 0

  role       = aws_iam_role.ec2_runner[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# Instance profile for EC2 runners
resource "aws_iam_instance_profile" "ec2_runner" {
  count = var.github_oidc.ec2_runner_instance_profile.enabled ? 1 : 0

  name = "${var.site.label}-${var.github_oidc.ec2_runner_instance_profile.name}"
  role = aws_iam_role.ec2_runner[0].name

  tags = {
    Name      = "${var.site.label}-${var.github_oidc.ec2_runner_instance_profile.name}"
    Site      = var.site.label
    Purpose   = "github-runner"
    ManagedBy = "Terragrunt"
  }
}
