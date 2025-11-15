output "email_zonenames" {
  description = "SSM parameter for email zone names"
  value       = aws_ssm_parameter.email_zonenames.value
  sensitive   = true
}

output "aws_emailuri" {
  description = "SSM parameter for AWS email URI"
  value       = nonsensitive(aws_ssm_parameter.aws_emailuri.value)
}

output "smtp_host" {
  description = "SSM parameter for SMTP host"
  value       = nonsensitive(aws_ssm_parameter.smtp_host.value)
}

output "from_address" {
  description = "SSM parameter for SES from address"
  value       = nonsensitive(aws_ssm_parameter.ses_from_address.value)
}

output "replyto_address" {
  description = "SSM parameter for SES reply-to address"
  value       = nonsensitive(aws_ssm_parameter.ses_replyto_address.value)
}

output "received_emails_bucket_name" {
  description = "Name of the S3 bucket for received emails"
  value       = aws_s3_bucket.received_emails.id
}

output "received_emails_bucket_arn" {
  description = "ARN of the S3 bucket for received emails"
  value       = aws_s3_bucket.received_emails.arn
}

output "smtp_credential_usernames" {
  description = "Map of email addresses to their SMTP credential usernames (IAM access key IDs)"
  value       = { for email in var.smtp_iam_users : email => aws_ssm_parameter.smtp_credential_username[email].value }
  sensitive   = true
}

output "smtp_credential_passwords" {
  description = "Map of email addresses to their SMTP credential passwords (SES SMTP passwords)"
  value       = { for email in var.smtp_iam_users : email => aws_ssm_parameter.smtp_credential_password[email].value }
  sensitive   = true
}

output "smtp_credential_urls" {
  description = "Map of email addresses to their SMTP connection URLs"
  value       = { for email in var.smtp_iam_users : email => aws_ssm_parameter.smtp_credential_url[email].value }
  sensitive   = true
}
