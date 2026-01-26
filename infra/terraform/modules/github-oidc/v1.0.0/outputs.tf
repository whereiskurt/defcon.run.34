# OIDC Provider outputs
output "oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider"
  value       = aws_iam_openid_connect_provider.github.arn
}

output "oidc_provider_url" {
  description = "URL of the GitHub OIDC provider"
  value       = aws_iam_openid_connect_provider.github.url
}

# Role outputs - map by role name
output "roles" {
  description = "Map of GitHub Actions roles by name"
  value = {
    for name, role in aws_iam_role.github_role :
    name => {
      arn  = role.arn
      name = role.name
      id   = role.id
    }
  }
}

# Simplified role ARN map for easy reference
output "role_arns" {
  description = "Map of role ARNs by role name"
  value = {
    for name, role in aws_iam_role.github_role :
    name => role.arn
  }
}

# GitHub repository info for reference
output "github_info" {
  description = "GitHub repository information"
  value = {
    org  = var.github_oidc.github_org
    repo = var.github_oidc.github_repo
  }
}

# Trust policy for management account delegate role
# Create a role in the management account with this trust policy
# to allow the GitHub roles to assume it for Route53/DNS operations
output "management_account_trust_policy" {
  description = "Trust policy JSON for creating a delegate role in the management account"
  value = var.github_oidc.management_account_id != null ? jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowAssumeFromGitHubRoles"
        Effect = "Allow"
        Principal = {
          AWS = [for name, role in aws_iam_role.github_role : role.arn]
        }
        Action = "sts:AssumeRole"
        Condition = {
          StringEquals = {
            "sts:ExternalId" = var.site.label
          }
        }
      }
    ]
  }) : null
}

# Instructions for setting up management account
output "management_account_setup" {
  description = "Instructions for setting up cross-account access in management account"
  value = var.github_oidc.management_account_id != null ? {
    account_id = var.github_oidc.management_account_id
    role_name  = "${var.site.label}-github-delegate"
    role_arn   = "arn:aws:iam::${var.github_oidc.management_account_id}:role/${var.site.label}-github-delegate"
    instructions = <<-EOT
      Create this role in the management account (${var.github_oidc.management_account_id}):

      1. Role name: ${var.site.label}-github-delegate
      2. Trust policy: Use the 'management_account_trust_policy' output
      3. Permissions: Attach policies for Route53, or whatever the role needs

      Then update site.hcl to add this ARN to cross_account_arns for roles that need it.
    EOT
  } : null
}

# EC2 Runner instance profile outputs
output "ec2_runner_instance_profile" {
  description = "EC2 runner instance profile details"
  value = var.github_oidc.ec2_runner_instance_profile.enabled ? {
    name     = aws_iam_instance_profile.ec2_runner[0].name
    arn      = aws_iam_instance_profile.ec2_runner[0].arn
    role_arn = aws_iam_role.ec2_runner[0].arn
  } : null
}
