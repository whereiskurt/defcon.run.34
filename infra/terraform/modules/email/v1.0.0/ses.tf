# Data source for Route53 zones
data "aws_route53_zone" "email_zonename" {
  name     = var.email.zonename
  provider = aws.global-application
}

data "aws_route53_zone" "mgmt" {
  name     = var.dns.zonename
  provider = aws.global-management
}

# Receipt rule set for receiving emails
resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "${var.site.label}-${var.email.zonename}"
}

# Activate the receipt rule set
resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

# Root SES Domain (email.defcon.run)
module "ses_root" {
  source = "./ses-domain"

  domain_name         = var.email.zonename
  mail_from_domain    = "${var.email.smtp_prefix}.${var.email.zonename}"
  route53_zone_id     = data.aws_route53_zone.email_zonename.zone_id
  region              = var.region.full
  enable_mail_from_mx = true
  enable_receive_mx   = true
  s3_bucket_id        = aws_s3_bucket.received_emails.id
  rule_set_name       = aws_ses_receipt_rule_set.main.rule_set_name
  # primary_domain_identity    = module.ses_regional.domain_identity

  receipt_rule_config = {
    enabled           = true
    rule_name         = var.email.zonename
    recipient_address = var.email.zonename
    s3_key_prefix     = "inbox/${var.email.zonename}/"
  }

  depends_on = [aws_s3_bucket_policy.received_emails]

  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-application
  }
}

# Regional SES Domain (use1.email.defcon.run)
module "ses_regional" {
  count               = var.use_smtp_region ? 1 : 0
  source              = "./ses-domain"
  domain_name         = "${var.region.label}.${var.email.zonename}"
  mail_from_domain    = "${var.email.smtp_prefix}.${var.region.label}.${var.email.zonename}"
  route53_zone_id     = data.aws_route53_zone.email_zonename.zone_id
  region              = var.region.full
  enable_mail_from_mx = true
  enable_receive_mx   = true
  s3_bucket_id        = aws_s3_bucket.received_emails.id
  rule_set_name       = aws_ses_receipt_rule_set.main.rule_set_name

  receipt_rule_config = {
    enabled           = true
    rule_name         = "${var.region.label}.${var.email.zonename}"
    recipient_address = "${var.region.label}.${var.email.zonename}"
    s3_key_prefix     = "inbox/${var.region.label}.${var.email.zonename}/"
  }

  depends_on = [aws_s3_bucket_policy.received_emails]
  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-application
  }
}

# Management SES Domain (defcon.run)
module "ses_mgmt" {
  count               = var.use_smtp_site ? 1 : 0
  source              = "./ses-domain"
  domain_name         = var.dns.zonename
  mail_from_domain    = "${var.email.smtp_prefix}.${var.dns.zonename}"
  route53_zone_id     = data.aws_route53_zone.mgmt.zone_id
  region              = var.region.full
  enable_mail_from_mx = true
  enable_receive_mx   = true
  s3_bucket_id        = aws_s3_bucket.received_emails.id
  rule_set_name       = aws_ses_receipt_rule_set.main.rule_set_name
  # primary_domain_identity    = module.ses_regional.domain_identity

  receipt_rule_config = {
    enabled           = true
    rule_name         = var.dns.zonename
    recipient_address = var.dns.zonename
    s3_key_prefix     = "inbox/${var.dns.zonename}/"
  }

  depends_on = [aws_s3_bucket_policy.received_emails]

  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-management
  }
}

