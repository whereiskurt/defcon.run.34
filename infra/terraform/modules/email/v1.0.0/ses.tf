# Data source for Route53 zones
data "aws_route53_zone" "email_zonenames" {
  for_each = toset(var.email.zonenames)
  name     = each.value
  provider = aws.global-application
}

data "aws_route53_zone" "mgmt" {
  name     = var.dns.zonename
  provider = aws.global-management
}

# Receipt rule set for receiving emails
resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "${var.site.label}-email"
}

# Activate the receipt rule set
resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

# Root SES Domains (email.defcon.run, run.defcon.run, etc...)
module "ses_root" {
  for_each = var.conf.make_domains && var.region.full == var.site.primary_region ? toset(var.email.zonenames) : []
  source   = "./ses-domain"

  domain_name         = each.value
  mail_from_domain    = "${var.email.smtp_prefix}.${each.value}"
  route53_zone_id     = data.aws_route53_zone.email_zonenames[each.key].zone_id
  region              = var.region.full
  enable_mail_from_mx = true
  enable_receive_mx   = true
  s3_bucket_id        = aws_s3_bucket.received_emails.id
  rule_set_name       = aws_ses_receipt_rule_set.main.rule_set_name

  receipt_rule_config = {
    enabled           = true
    rule_name         = each.value
    recipient_address = each.value
    s3_key_prefix     = "inbox/${each.value}/"
  }

  depends_on = [aws_s3_bucket_policy.received_emails]

  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-application
  }
}

# Regional SES Domains (use1.email.defcon.run, use1.run.defcon.run, etc...)
module "ses_regional" {
  for_each            = var.conf.make_regional_domains ? toset(var.email.zonenames) : []
  source              = "./ses-domain"
  domain_name         = "${var.region.label}.${each.value}"
  mail_from_domain    = "${var.email.smtp_prefix}.${var.region.label}.${each.value}"
  route53_zone_id     = data.aws_route53_zone.email_zonenames[each.key].zone_id
  region              = var.region.full
  enable_mail_from_mx = true
  enable_receive_mx   = true
  s3_bucket_id        = aws_s3_bucket.received_emails.id
  rule_set_name       = aws_ses_receipt_rule_set.main.rule_set_name

  receipt_rule_config = {
    enabled           = true
    rule_name         = "${var.region.label}.${each.value}"
    recipient_address = "${var.region.label}.${each.value}"
    s3_key_prefix     = "inbox/${var.region.label}.${each.value}/"
  }

  depends_on = [aws_s3_bucket_policy.received_emails]
  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-application
  }
}

# Management SES Domain (defcon.run)
module "ses_mgmt" {
  count               = var.conf.make_site_domain && var.region.full == var.site.primary_region ? 1 : 0
  source              = "./ses-domain"
  domain_name         = var.dns.zonename
  mail_from_domain    = "${var.email.smtp_prefix}.${var.dns.zonename}"
  route53_zone_id     = data.aws_route53_zone.mgmt.zone_id
  region              = var.region.full
  enable_mail_from_mx = true
  enable_receive_mx   = true
  s3_bucket_id        = aws_s3_bucket.received_emails.id
  rule_set_name       = aws_ses_receipt_rule_set.main.rule_set_name

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

# Management SES Domain (use1.defcon.run)
module "ses_mgmt_regional" {
  count               = var.conf.make_site_domain == true && var.region.full == var.site.primary_region && var.conf.make_regional_domains == true ? 1 : 0
  source              = "./ses-domain"
  domain_name         = "${var.region.label}.${var.dns.zonename}"
  mail_from_domain    = "${var.email.smtp_prefix}.${var.region.label}.${var.dns.zonename}"
  route53_zone_id     = data.aws_route53_zone.mgmt.zone_id
  region              = var.region.full
  enable_mail_from_mx = true
  enable_receive_mx   = true
  s3_bucket_id        = aws_s3_bucket.received_emails.id
  rule_set_name       = aws_ses_receipt_rule_set.main.rule_set_name

  receipt_rule_config = {
    enabled           = true
    rule_name         = "${var.region.label}.${var.dns.zonename}"
    recipient_address = "${var.region.label}.${var.dns.zonename}"
    s3_key_prefix     = "inbox/${var.region.label}.${var.dns.zonename}/"
  }

  depends_on = [aws_s3_bucket_policy.received_emails]

  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-management
  }
}