# SSM Parameter Store implementation
# Creates one SecureString parameter per secret/key combination in each region
# Used when use_secrets_manager = false

resource "aws_ssm_parameter" "secret" {
  for_each = var.secrets.use_secrets_manager ? {} : local.ssm_secrets

  name        = "${local.ssm_prefix}/${each.key}"
  description = "${each.value.description} - ${each.value.key}"
  type        = "SecureString"
  value       = each.value.value
  key_id      = aws_kms_key.ssm.arn

  tags = {
    Site       = var.site.label
    Region     = var.region.label
    SecretName = each.value.secret_name
    SecretKey  = each.value.key
  }

  lifecycle {
    ignore_changes = [
      # Don't replace if value changes externally (allows manual updates)
      # Remove this if you want Terraform to always enforce the value
    ]
  }
}
