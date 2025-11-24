output "web_acl_id" {
  description = "The ID of the WAF Web ACL"
  value       = var.enabled ? aws_wafv2_web_acl.this[0].id : null
}

output "web_acl_arn" {
  description = "The ARN of the WAF Web ACL"
  value       = var.enabled ? aws_wafv2_web_acl.this[0].arn : null
}

output "web_acl_capacity" {
  description = "The capacity of the WAF Web ACL"
  value       = var.enabled ? aws_wafv2_web_acl.this[0].capacity : null
}

output "web_acl_name" {
  description = "The name of the WAF Web ACL"
  value       = var.enabled ? aws_wafv2_web_acl.this[0].name : null
}

output "managed_rules" {
  description = "List of managed rules in this ruleset"
  value       = var.enabled ? [for rule in var.managed_rules : rule.name] : []
}

output "custom_rules" {
  description = "List of custom rules in this ruleset"
  value       = var.enabled ? [for rule in var.custom_rules : rule.name] : []
}

output "ruleset_name" {
  description = "Name of the ruleset"
  value       = var.ruleset_name
}
