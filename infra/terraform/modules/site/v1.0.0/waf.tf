# WAF Web ACL Module
# Note: WAF for CloudFront must be created in us-east-1 (CLOUDFRONT scope)
# Multiple rulesets can be defined, each creating a separate Web ACL

module "waf" {
  for_each = var.waf.enabled ? toset(keys(var.waf.rulesets)) : toset([])
  source   = "./waf"

  site_label             = var.site.label
  ruleset_name           = each.key
  log_mode               = var.waf.log_mode
  enabled                = var.waf.rulesets[each.key].enabled
  managed_rules          = var.waf.rulesets[each.key].managed_rules
  custom_rules           = var.waf.rulesets[each.key].custom_rules
  custom_response_bodies = var.waf.rulesets[each.key].custom_response_bodies

  providers = {
    aws.global-application = aws.global-application
  }
}
