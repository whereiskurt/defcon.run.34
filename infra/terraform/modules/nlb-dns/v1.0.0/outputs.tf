output "fqdn" {
  description = "FQDN of the created DNS record"
  value       = aws_route53_record.nlb_alias.fqdn
}

output "name" {
  description = "Name of the created DNS record"
  value       = aws_route53_record.nlb_alias.name
}
