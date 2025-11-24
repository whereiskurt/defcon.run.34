output "zone_map" {
  value = merge(
    {
      for _, v in aws_route53_zone.account_zonenames :
      v.name => { "zone_id" : v.zone_id, "name" : v.name, "name_servers" : v.name_servers }
    },
    {
      (data.aws_route53_zone.mgmt.name) = {
        "zone_id" : data.aws_route53_zone.mgmt.zone_id,
        "name" : data.aws_route53_zone.mgmt.name,
        "name_servers" : data.aws_route53_zone.mgmt.name_servers
      }
    }
  )
  sensitive = false
}

output "waf" {
  description = "Map of WAF Web ACL rulesets for CloudFront integration"
  value = var.waf.enabled ? {
    for ruleset_name, ruleset in module.waf : ruleset_name => {
      web_acl_id       = ruleset.web_acl_id
      web_acl_arn      = ruleset.web_acl_arn
      web_acl_name     = ruleset.web_acl_name
      web_acl_capacity = ruleset.web_acl_capacity
      managed_rules    = ruleset.managed_rules
      custom_rules     = ruleset.custom_rules
    }
  } : {}
  sensitive = false
}
