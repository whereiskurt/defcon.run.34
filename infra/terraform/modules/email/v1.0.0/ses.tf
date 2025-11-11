resource "aws_ses_domain_identity" "this" {
  domain   = local.email_zonename
  provider = aws.application
}

resource "aws_ses_domain_dkim" "this" {
  depends_on = [aws_ses_domain_identity.this]
  domain     = local.email_zonename
  provider   = aws.application
}

resource "aws_ses_domain_mail_from" "this" {
  depends_on             = [aws_ses_domain_identity.this]
  domain                 = local.email_zonename
  mail_from_domain       = local.smtp_zonename
  behavior_on_mx_failure = "UseDefaultValue"
  provider               = aws.application
}