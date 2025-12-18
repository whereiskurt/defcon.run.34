# AWS Secrets Manager implementation
# Creates secrets in primary region with automatic replication to replica regions
# Used when use_secrets_manager = true

resource "aws_secretsmanager_secret" "secret" {
  for_each = local.secretsmanager_secrets

  name        = "${local.sm_prefix}/${each.key}"
  description = each.value.description

  # Multi-region replication
  dynamic "replica" {
    for_each = var.secrets.replica_regions
    content {
      region = replica.value.full
    }
  }

  tags = {
    Site       = var.site.label
    SecretName = each.key
  }
}

resource "aws_secretsmanager_secret_version" "secret" {
  for_each = local.secretsmanager_secrets

  secret_id     = aws_secretsmanager_secret.secret[each.key].id
  secret_string = each.value.value
}
