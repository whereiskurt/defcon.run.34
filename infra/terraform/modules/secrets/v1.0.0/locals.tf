locals {
  # Skip this region if it's in the skip list
  skip_region = contains(var.site.skip_regions, var.region.full)

  # Determine if this is the primary region (for Secrets Manager mode)
  is_primary_region = var.region.full == var.secrets.primary_region

  # Variable substitutions for path prefixes
  path_vars = {
    "{{SITE_LABEL}}"   = var.site.label
    "{{REGION_LABEL}}" = var.region.label
    "{{REGION}}"       = var.region.full
  }

  # Interpolate SSM prefix template
  ssm_prefix = replace(
    replace(
      replace(
        var.secrets.ssm_prefix,
        "{{SITE_LABEL}}", var.site.label
      ),
      "{{REGION_LABEL}}", var.region.label
    ),
    "{{REGION}}", var.region.full
  )

  # Interpolate Secrets Manager prefix template
  sm_prefix = replace(
    replace(
      replace(
        var.secrets.sm_prefix,
        "{{SITE_LABEL}}", var.site.label
      ),
      "{{REGION_LABEL}}", var.region.label
    ),
    "{{REGION}}", var.region.full
  )

  # Build a flattened map of all secret/key combinations for SSM
  # Result: { "strava/client_id" = { secret = "strava", key = "client_id", value = "xxx" }, ... }
  ssm_secrets = local.skip_region ? {} : {
    for pair in flatten([
      for secret_name, secret_def in var.secrets.definitions : [
        for key in secret_def.keys : {
          secret_name = secret_name
          key         = key
          description = secret_def.description
          value       = try(var.secret_values[secret_name][key], "")
        }
      ]
    ]) : "${pair.secret_name}/${pair.key}" => pair
  }

  # For Secrets Manager: build the secret value as JSON per secret
  # Only in primary region, and only when use_secrets_manager = true
  secretsmanager_secrets = (
    local.skip_region || !var.secrets.use_secrets_manager || !local.is_primary_region
  ) ? {} : {
    for secret_name, secret_def in var.secrets.definitions : secret_name => {
      description = secret_def.description
      value = jsonencode({
        for key in secret_def.keys : key => try(var.secret_values[secret_name][key], "")
      })
    }
  }
}
