# Receipt rule set for receiving emails
resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "${var.site.label}-email"
}

# Activate the receipt rule set
resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
}

# Local to pick the last forwarding rule for ordering (receiving rules come after all forwarding)
locals {
  # Use the last rule in the sorted list so receiving rules come after all forwarding rules
  last_fwd_rule_name = length(local.sorted_fwd_rules) > 0 ? "forward-${replace(local.sorted_fwd_rules[length(local.sorted_fwd_rules) - 1], "@", "-at-")}" : null
}

# Root SES Domains (email.defcon.run, run.defcon.run, etc...)
module "ses_root" {
  for_each = var.email.make_domains && var.region.full == var.email.primary_region ? toset(var.email.zonenames) : []
  source   = "./ses-domain"

  domain_name         = each.value
  mail_from_domain    = "${var.email.smtp_prefix}.${each.value}"
  route53_zone_id     = var.zone_map[each.value].zone_id
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

  receipt_rule_after = local.last_fwd_rule_name

  depends_on = [
    aws_s3_bucket_policy.received_emails,
    aws_ses_receipt_rule.forwarding
  ]

  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-application
  }
}

# Regional SES Domains (use1.email.defcon.run, use1.run.defcon.run, etc...)
module "ses_regional" {
  for_each            = var.email.make_regional_domains ? toset(var.email.zonenames) : []
  source              = "./ses-domain"
  domain_name         = "${var.region.label}.${each.value}"
  mail_from_domain    = "${var.email.smtp_prefix}.${var.region.label}.${each.value}"
  route53_zone_id     = var.zone_map[each.value].zone_id
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

  receipt_rule_after = local.last_fwd_rule_name

  depends_on = [
    aws_s3_bucket_policy.received_emails,
    aws_ses_receipt_rule.forwarding
  ]
  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-application
  }
}

# Management SES Domain (defcon.run)
module "ses_mgmt" {
  count               = var.email.make_site_domain && var.region.full == var.email.primary_region ? 1 : 0
  source              = "./ses-domain"
  domain_name         = var.dns.zonename
  mail_from_domain    = "${var.email.smtp_prefix}.${var.dns.zonename}"
  route53_zone_id     = var.zone_map[var.dns.zonename].zone_id
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

  receipt_rule_after = local.last_fwd_rule_name

  depends_on = [
    aws_s3_bucket_policy.received_emails,
    aws_ses_receipt_rule.forwarding
  ]

  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-management
  }
}

# Management SES Domain (use1.defcon.run, cac1.defcon.run)
module "ses_mgmt_regional" {
  count               = var.email.make_site_domain == true && var.email.make_regional_domains == true ? 1 : 0
  source              = "./ses-domain"
  domain_name         = "${var.region.label}.${var.dns.zonename}"
  mail_from_domain    = "${var.email.smtp_prefix}.${var.region.label}.${var.dns.zonename}"
  route53_zone_id     = var.zone_map[var.dns.zonename].zone_id
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

  receipt_rule_after = local.last_fwd_rule_name

  depends_on = [
    aws_s3_bucket_policy.received_emails,
    aws_ses_receipt_rule.forwarding
  ]

  providers = {
    aws.application       = aws.application
    aws.global-management = aws.global-management
  }
}
