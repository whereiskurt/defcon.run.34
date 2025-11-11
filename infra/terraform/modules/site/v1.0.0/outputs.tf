output "zone_map" {
  value = {
    for _, v in aws_route53_zone.account_zonenames :
    v.name => { "zone_id" : v.zone_id, "name" : v.name, "name_servers" : v.name_servers }
  }
  sensitive = false
}

output "global_waf_webacl_arn" {
  value     = var.waf.enabled ? "aws_wafv2_web_acl.this[0].arn": null
  sensitive = false
}
