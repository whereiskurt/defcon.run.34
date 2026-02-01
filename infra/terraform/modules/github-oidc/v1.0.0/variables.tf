variable "site" {
  type = object({
    label         = string
    random_suffix = string
  })
  description = "Site configuration"
}

variable "github_oidc" {
  type = object({
    enabled     = bool
    github_org  = string
    github_repo = string

    # Optional: Management account ID for cross-account access
    # If set, outputs will include the trust policy needed in the management account
    management_account_id = optional(string, null)

    # Optional: Create EC2 instance profile for self-hosted runners
    # Enables SSM access for debugging and runner management
    ec2_runner_instance_profile = optional(object({
      enabled = bool
      name    = optional(string, "github-runner")
    }), { enabled = false })

    roles = list(object({
      name        = string
      description = optional(string, "GitHub Actions role")

      # Restrictions - only one should be set, or none for wildcard access
      branch_restriction      = optional(string, null)      # e.g., "main"
      environment_restriction = optional(string, null)      # e.g., "production"

      # IAM permissions in this account
      policy_arns = optional(list(string), [])

      # Inline policies (10KB combined limit per role - use managed_policies for larger needs)
      inline_policies = optional(list(object({
        name   = string
        policy = string
      })), [])

      # Customer-managed policies (6KB each, up to 20 per role)
      # Use this when inline_policies exceed 10KB limit
      managed_policies = optional(list(object({
        name   = string
        policy = string
      })), [])

      # Cross-account role ARNs this role can assume
      # e.g., ["arn:aws:iam::MGMT_ACCOUNT:role/github-delegate-route53"]
      cross_account_arns = optional(list(string), [])

      max_session_duration = optional(number, 3600)
    }))
  })
  description = "GitHub OIDC configuration"
}
