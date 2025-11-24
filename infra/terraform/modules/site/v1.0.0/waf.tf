# WAF Web ACL Module
# Note: WAF for CloudFront must be created in us-east-1 (CLOUDFRONT scope)
# Multiple rulesets can be defined, each creating a separate Web ACL

module "waf" {
  for_each = var.waf.enabled ? var.waf.rulesets : {}
  source   = "./waf"

  site_label    = var.site.label
  ruleset_name  = each.key
  log_mode      = var.waf.log_mode
  enabled       = each.value.enabled
  managed_rules = each.value.managed_rules
  custom_rules  = each.value.custom_rules

  providers = {
    aws.global-application = aws.global-application
  }
}
