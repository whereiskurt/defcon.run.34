output "redirect_rule_arns" {
  description = "ARNs of the created ALB redirect listener rules, keyed by host label."
  value       = { for k, r in aws_lb_listener_rule.redirect : k => r.arn }
}

output "redirect_fqdns" {
  description = "FQDNs of the created redirect hosts."
  value       = [for k, rec in aws_route53_record.redirect_alias : rec.fqdn]
}
