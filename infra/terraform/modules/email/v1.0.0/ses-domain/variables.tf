variable "domain_name" {
  description = "The domain name to configure for SES"
  type        = string
}

variable "mail_from_domain" {
  description = "The MAIL FROM domain (e.g., smtp.example.com)"
  type        = string
}

variable "route53_zone_id" {
  description = "The Route53 zone ID for DNS records"
  type        = string
}

variable "region" {
  description = "AWS region for SES endpoints"
  type        = string
}

variable "enable_mail_from_mx" {
  description = "Whether to create MX record for mail_from_domain (only for regional)"
  type        = bool
  default     = false
}

variable "enable_receive_mx" {
  description = "Whether to create MX record for receiving emails"
  type        = bool
  default     = true
}

variable "s3_bucket_id" {
  description = "S3 bucket ID for storing received emails"
  type        = string
  default     = ""
}

variable "rule_set_name" {
  description = "SES receipt rule set name"
  type        = string
  default     = ""
}

variable "receipt_rule_config" {
  description = "Configuration for SES receipt rule"
  type = object({
    enabled           = bool
    rule_name         = string
    recipient_address = string
    s3_key_prefix     = string
  })
  default = null
}

variable "s3_bucket_policy_dependency" {
  description = "Dependency on S3 bucket policy"
  type        = any
  default     = null
}

variable "primary_domain_identity" {
  description = "Primary SES domain identity to depend on (for mail_from)"
  type        = any
  default     = null
}
