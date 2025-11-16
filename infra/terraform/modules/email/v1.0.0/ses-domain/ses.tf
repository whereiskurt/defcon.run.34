# SES Domain Identity (uses application provider)
resource "aws_ses_domain_identity" "this" {
  domain   = var.domain_name
  provider = aws.application
}

# SES DKIM (uses application provider)
resource "aws_ses_domain_dkim" "this" {
  depends_on = [aws_ses_domain_identity.this]
  domain     = var.domain_name
  provider   = aws.application
}

# SES Mail From Domain - depends on primary identity if provided, otherwise on local identity
resource "aws_ses_domain_mail_from" "this_with_primary" {
  count                  = var.mail_from_domain != "" && var.primary_domain_identity != null ? 1 : 0
  domain                 = var.domain_name
  mail_from_domain       = var.mail_from_domain
  behavior_on_mx_failure = "UseDefaultValue"
  provider               = aws.application

  depends_on = [var.primary_domain_identity]
}

resource "aws_ses_domain_mail_from" "this_without_primary" {
  count                  = var.mail_from_domain != "" && var.primary_domain_identity == null ? 1 : 0
  domain                 = var.domain_name
  mail_from_domain       = var.mail_from_domain
  behavior_on_mx_failure = "UseDefaultValue"
  provider               = aws.application

  depends_on = [aws_ses_domain_identity.this]
}

# Receipt rule for support@ emails (uses application provider)
resource "aws_ses_receipt_rule" "support" {
  count         = var.receipt_rule_config != null ? 1 : 0
  name          = var.receipt_rule_config.rule_name
  rule_set_name = var.rule_set_name
  recipients    = [var.receipt_rule_config.recipient_address]
  enabled       = var.receipt_rule_config.enabled
  scan_enabled  = true
  provider      = aws.application

  s3_action {
    bucket_name       = var.s3_bucket_id
    object_key_prefix = var.receipt_rule_config.s3_key_prefix
    position          = 1
  }

  # depends_on = [var.s3_bucket_policy_dependency]
}
