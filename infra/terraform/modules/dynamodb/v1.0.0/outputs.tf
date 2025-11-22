output "tables" {
  description = "Map of all DynamoDB tables with their details"
  value = {
    for name, table in local.tables_output : name => {
      table_name        = table.table_name
      table_arn         = table.table_arn
      table_id          = table.table_id
      stream_arn        = table.stream_arn
      is_primary_region = table.is_primary_region
    }
  }
}

output "iam_users" {
  description = "Map of IAM users for DynamoDB access, keyed by table name"
  value = {
    for name, user in aws_iam_user.dynamodb_user : name => {
      name = user.name
      arn  = user.arn
    }
  }
}

output "access_keys" {
  description = "Map of access key IDs for IAM users, keyed by table name"
  value = {
    for name, key in aws_iam_access_key.dynamodb_user : name => key.id
  }
  sensitive = true
}

output "secret_access_keys" {
  description = "Map of secret access keys for IAM users, keyed by table name"
  value = {
    for name, key in aws_iam_access_key.dynamodb_user : name => key.secret
  }
  sensitive = true
}

output "ssm_prefixes" {
  description = "Map of SSM parameter store prefixes for each table"
  value = {
    for name, config in local.table_configs : name => "/${var.site.label}/dynamodb/${var.region.label}/${config.table_name}"
  }
}

output "region" {
  description = "The AWS region where the tables are deployed"
  value       = var.region.full
}
