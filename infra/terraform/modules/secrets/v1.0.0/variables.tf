variable "site" {
  type = object({
    label         = string
    random_suffix = optional(string, "")
    skip_regions  = optional(list(string), [])
  })
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
}

variable "secrets" {
  description = "Secrets configuration - structure defines what secrets exist, values come from secrets_values"
  type = object({
    # Whether to use Secrets Manager with replication (true) or SSM Parameter Store per-region (false)
    use_secrets_manager = optional(bool, false)

    # Primary region for Secrets Manager (only used when use_secrets_manager = true)
    # Secrets are created in primary region and replicated to replica_regions
    primary_region = optional(string, "us-east-1")

    # Regions to replicate secrets to (only used when use_secrets_manager = true)
    replica_regions = optional(list(object({
      label = string
      full  = string
    })), [])

    # Path prefix template for SSM parameters
    # Supports variables: {{SITE_LABEL}}, {{REGION_LABEL}}, {{REGION}}
    # Example: "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}" -> "/<site_label>/secrets/use1"
    # Default: "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}"
    ssm_prefix = optional(string, "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}")

    # Path prefix template for Secrets Manager (no region since it replicates)
    # Supports variables: {{SITE_LABEL}}
    # Example: "/{{SITE_LABEL}}/secrets" -> "/<site_label>/secrets"
    # Default: "/{{SITE_LABEL}}/secrets"
    sm_prefix = optional(string, "/{{SITE_LABEL}}/secrets")

    # Secret definitions - structure only, values come from secret_values variable
    # Each secret can have multiple keys (e.g., client_id, client_secret)
    definitions = map(object({
      description = optional(string, "")
      keys        = list(string)
    }))
  })
}

variable "secret_values" {
  description = "Secret values - map of secret_name -> key -> value. Marked sensitive."
  type        = map(map(string))
  sensitive   = true
  default     = {}
}
