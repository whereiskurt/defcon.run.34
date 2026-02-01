# SSM Parameters for SES/Email configuration
# String parameters store non-sensitive configuration (hostnames, addresses, bucket info)
# SecureString parameters (SMTP credentials) use KMS encryption via kms.tf

locals {
  ses = "${var.site.label}/ses"
}

#checkov:skip=CKV2_AWS_34:Zone names are non-sensitive configuration
resource "aws_ssm_parameter" "email_zonenames" {
  name  = "/${local.ses}/zonenames"
  type  = "StringList"
  value = join(",", var.email.zonenames)
}

#checkov:skip=CKV2_AWS_34:Boolean config flags are non-sensitive
resource "aws_ssm_parameter" "make_regional_domains" {
  name  = "/${local.ses}/make_regional_domains"
  type  = "String"
  value = var.email.make_regional_domains
}

#checkov:skip=CKV2_AWS_34:Boolean config flags are non-sensitive
resource "aws_ssm_parameter" "make_site_domain" {
  name  = "/${local.ses}/make_site_domain"
  type  = "String"
  value = var.email.make_site_domain
}

#checkov:skip=CKV2_AWS_34:Boolean config flags are non-sensitive
resource "aws_ssm_parameter" "make_domains" {
  name  = "/${local.ses}/make_domains"
  type  = "String"
  value = var.email.make_domains
}

#checkov:skip=CKV2_AWS_34:AWS service URLs are non-sensitive
resource "aws_ssm_parameter" "aws_emailuri" {
  name  = "/${local.ses}/awsuri"
  type  = "String"
  value = "https://email.${var.region.full}.amazonaws.com"
}

#checkov:skip=CKV2_AWS_34:SMTP hostnames are non-sensitive
resource "aws_ssm_parameter" "smtp_host" {
  name  = "/${local.ses}/smtp_host"
  type  = "String"
  value = "email-smtp.${var.region.full}.amazonaws.com"
}

#checkov:skip=CKV2_AWS_34:From addresses are non-sensitive
resource "aws_ssm_parameter" "ses_from_address" {
  name  = "/${local.ses}/from_address"
  type  = "String"
  value = "support@${var.email.zonenames[0]}"
}

#checkov:skip=CKV2_AWS_34:Reply-to addresses are non-sensitive
resource "aws_ssm_parameter" "ses_replyto_address" {
  name  = "/${local.ses}/replyto_address"
  type  = "String"
  value = "reply-to@${var.email.zonenames[0]}"
}

# SMTP credentials for individual email addresses
# Supports both email format (user@domain.com) and simple usernames (strapi)
locals {
  # Create a map with the proper path structure for each user
  smtp_user_paths = {
    for user in var.smtp_iam_users :
    user => contains(split("", user), "@") ? {
      domain   = split("@", user)[1]
      username = split("@", user)[0]
      path     = "${split("@", user)[1]}/${split("@", user)[0]}"
      } : {
      domain   = "default"
      username = user
      path     = "default/${user}"
    }
  }
}

resource "aws_ssm_parameter" "smtp_credential_username" {
  for_each = toset(var.smtp_iam_users)
  name     = "/${local.ses}/smtp/${local.smtp_user_paths[each.value].path}/username"
  type     = "SecureString"
  value    = aws_iam_access_key.smtp_credential_keys[each.key].id
  key_id   = aws_kms_key.ssm.arn
  tags = {
    Email = each.value
  }
}

resource "aws_ssm_parameter" "smtp_credential_password" {
  for_each = toset(var.smtp_iam_users)
  name     = "/${local.ses}/smtp/${local.smtp_user_paths[each.value].path}/password"
  type     = "SecureString"
  value    = aws_iam_access_key.smtp_credential_keys[each.key].ses_smtp_password_v4
  key_id   = aws_kms_key.ssm.arn
  tags = {
    Email = each.value
  }
}

resource "aws_ssm_parameter" "smtp_credential_url" {
  for_each = toset(var.smtp_iam_users)
  name     = "/${local.ses}/smtp/${local.smtp_user_paths[each.value].path}/url"
  type     = "SecureString"
  ##The replace is necessary because an IAM access key ID cannot contain slashes
  ##Slashes aren't URL friendly. Other chars like + are handled fine by most URL parsers but the '/' is not.
  value  = "smtp://${aws_iam_access_key.smtp_credential_keys[each.key].id}:${replace(aws_iam_access_key.smtp_credential_keys[each.key].ses_smtp_password_v4, "/", "%2F")}@email-smtp.${var.region.full}.amazonaws.com:587"
  key_id = aws_kms_key.ssm.arn
  tags = {
    Email = each.value
  }
}

# Email forwarding configuration
#checkov:skip=CKV2_AWS_34:Forwarding rules contain email addresses which are non-sensitive
resource "aws_ssm_parameter" "fwd_rules_rules" {
  count = length(var.fwd_rules) > 0 ? 1 : 0
  name  = "/${local.ses}/forwarding/rules"
  type  = "String"
  value = jsonencode({
    for rule in var.fwd_rules :
    rule.match => rule.send_to
  })
  description = "Email forwarding rules mapping custom domain addresses to external addresses"
}

# S3 bucket information for cross-region replication
# Store this bucket's info in the current region's SSM
#checkov:skip=CKV2_AWS_34:Bucket names are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "s3_bucket_name" {
  name        = "/${local.ses}/s3/${var.region.label}/bucket_name"
  type        = "String"
  value       = aws_s3_bucket.received_emails.id
  description = "S3 bucket name for received emails in ${var.region.full}"
}

#checkov:skip=CKV2_AWS_34:Bucket ARNs are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "s3_bucket_arn" {
  name        = "/${local.ses}/s3/${var.region.label}/bucket_arn"
  type        = "String"
  value       = aws_s3_bucket.received_emails.arn
  description = "S3 bucket ARN for received emails in ${var.region.full}"
}

# Cross-region bucket information cache
# Store information about OTHER regions' buckets in THIS region for easy lookup
# This allows each region to know about all buckets without cross-region API calls
#checkov:skip=CKV2_AWS_34:Bucket names are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "replica_bucket_name" {
  for_each = local.can_configure_replication ? local.replication_destinations_map : {}

  name = "/${local.ses}/s3/${each.value.label}/bucket_name"
  type = "String"
  # Extract bucket name from ARN: arn:aws:s3:::bucket-name -> bucket-name
  value       = replace(local.replica_bucket_arns[each.key], "arn:aws:s3:::", "")
  description = "Cached S3 bucket name for received emails in ${each.value.full} (replica)"
}

#checkov:skip=CKV2_AWS_34:Bucket ARNs are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "replica_bucket_arn" {
  for_each = local.can_configure_replication ? local.replication_destinations_map : {}

  name        = "/${local.ses}/s3/${each.value.label}/bucket_arn"
  type        = "String"
  value       = local.replica_bucket_arns[each.key]
  description = "Cached S3 bucket ARN for received emails in ${each.value.full} (replica)"
}
