output "domain_identity" {
  description = "SES domain identity resource"
  value       = aws_ses_domain_identity.this
}

output "domain_identity_arn" {
  description = "ARN of the SES domain identity"
  value       = aws_ses_domain_identity.this.arn
}

output "domain_identity_verification_token" {
  description = "Verification token for the domain"
  value       = aws_ses_domain_identity.this.verification_token
}

output "dkim_tokens" {
  description = "DKIM tokens for the domain"
  value       = aws_ses_domain_dkim.this.dkim_tokens
}

output "mail_from_domain" {
  description = "Mail from domain configuration"
  value       = try(aws_ses_domain_mail_from.this_with_primary[0], try(aws_ses_domain_mail_from.this_without_primary[0], null))
}
