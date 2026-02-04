# Outputs for ECS task definition integration
# Returns ARNs/paths that can be used in ECS secrets valueFrom

# SSM Parameter ARNs (when use_secrets_manager = false)
# Format: { "strava/client_id" = "arn:aws:ssm:region:account:parameter/<site_label>/secrets/use1/strava/client_id" }
output "ssm_parameter_arns" {
  description = "Map of secret/key to SSM parameter ARNs"
  value = {
    for key, param in aws_ssm_parameter.secret : key => param.arn
  }
}

# SSM Parameter names (when use_secrets_manager = false)
# Format: { "strava/client_id" = "/<site_label>/secrets/use1/strava/client_id" }
output "ssm_parameter_names" {
  description = "Map of secret/key to SSM parameter names (for ECS valueFrom)"
  value = {
    for key, param in aws_ssm_parameter.secret : key => param.name
  }
}

# Secrets Manager ARNs (when use_secrets_manager = true)
# Format: { "strava" = "arn:aws:secretsmanager:region:account:secret:<site_label>/secrets/strava-xxxxx" }
output "secretsmanager_arns" {
  description = "Map of secret name to Secrets Manager ARNs"
  value = {
    for key, secret in aws_secretsmanager_secret.secret : key => secret.arn
  }
}

# Secrets Manager names (when use_secrets_manager = true)
# Format: { "strava" = "/<site_label>/secrets/strava" }
output "secretsmanager_names" {
  description = "Map of secret name to Secrets Manager names"
  value = {
    for key, secret in aws_secretsmanager_secret.secret : key => secret.name
  }
}

# Helper output: ECS-compatible valueFrom paths
# For SSM: returns the parameter name directly
# For Secrets Manager: returns ARN with JSON key suffix (e.g., arn:xxx:secret:name:key::)
output "ecs_secret_refs" {
  description = "ECS-compatible valueFrom references for each secret/key combination"
  value = var.secrets.use_secrets_manager ? {
    # Secrets Manager format: ARN:json_key::
    for pair in flatten([
      for secret_name, secret_def in var.secrets.definitions : [
        for key in secret_def.keys : {
          ref_key     = "${secret_name}/${key}"
          secret_name = secret_name
          key         = key
        }
      ]
    ]) : pair.ref_key => local.is_primary_region ? (
      "${aws_secretsmanager_secret.secret[pair.secret_name].arn}:${pair.key}::"
    ) : null
  } : {
    # SSM format: parameter name
    for key, param in aws_ssm_parameter.secret : key => param.name
  }
}

# KMS key ARN for SSM parameter encryption
output "kms_key_arn" {
  description = "ARN of the KMS key used for SSM parameter encryption"
  value       = aws_kms_key.ssm.arn
}

# KMS key alias for SSM parameter encryption
output "kms_key_alias" {
  description = "Alias of the KMS key used for SSM parameter encryption"
  value       = aws_kms_alias.ssm.name
}

# Summary output for debugging
output "summary" {
  description = "Summary of created secrets"
  value = {
    mode              = var.secrets.use_secrets_manager ? "secrets_manager" : "ssm"
    region            = var.region.full
    is_primary        = local.is_primary_region
    ssm_count         = length(aws_ssm_parameter.secret)
    sm_count          = length(aws_secretsmanager_secret.secret)
    replica_regions   = var.secrets.use_secrets_manager ? [for r in var.secrets.replica_regions : r.full] : []
    kms_key_arn       = aws_kms_key.ssm.arn
  }
}
