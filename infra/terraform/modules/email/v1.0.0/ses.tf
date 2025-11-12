resource "aws_ses_domain_identity" "this" {
  domain   = local.email_zonename
}

resource "aws_ses_domain_dkim" "this" {
  depends_on = [aws_ses_domain_identity.this]
  domain     = local.email_zonename
}

resource "aws_ses_domain_mail_from" "this" {
  depends_on             = [aws_ses_domain_identity.this]
  domain                 = local.email_zonename
  mail_from_domain       = local.smtp_zonename
  behavior_on_mx_failure = "UseDefaultValue"
}

# Receipt rule set for receiving emails
resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "${var.site.label}-${var.email.zonename}"
}

# Activate the receipt rule set
resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

# Receipt rule for support@
resource "aws_ses_receipt_rule" "support" {
  name          = "support-email-to-s3"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = ["support@${local.email_zonename}"]
  enabled       = true
  scan_enabled  = true

  s3_action {
    bucket_name       = aws_s3_bucket.received_emails.id
    object_key_prefix = "emails/support/"
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.received_emails]
}