output "email_zonename" {
  description = "SSM parameter for email zone name"
  value       = aws_ssm_parameter.email_zonename.value
  sensitive   = true
}

output "aws_emailuri" {
  description = "SSM parameter for AWS email URI"
  value       = nonsensitive(aws_ssm_parameter.aws_emailuri.value)
}

output "smtp_url_with_v4" {
  description = "SSM parameter for SMTP URL with SigV4 password"
  value       = aws_ssm_parameter.smtp_url_with_v4.value
  sensitive   = true
}

output "smtp_host" {
  description = "SSM parameter for SMTP host"
  value       = nonsensitive(aws_ssm_parameter.smtp_host.value)
}

output "ses_access_key" {
  description = "SSM parameter for SES access key"
  value       = aws_ssm_parameter.ses_access_key.value
  sensitive   = true
}

output "ses_secret_key" {
  description = "SSM parameter for SES secret key"
  value       = aws_ssm_parameter.ses_secret_key.value
  sensitive   = true
}

output "from_address" {
  description = "SSM parameter for SES from address"
  value       = nonsensitive(aws_ssm_parameter.ses_from_address.value)
}

output "replyto_address" {
  description = "SSM parameter for SES reply-to address"
  value       = nonsensitive(aws_ssm_parameter.ses_replyto_address.value)

}
