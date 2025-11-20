variable "site" {
  description = "Site configuration"
  type = object({
    label         = string
    random_suffix = string
  })
}

variable "dns" {
  description = "DNS configuration"
  type = object({
    zonename   = string
    subdomains = list(string)
    ttl        = number
  })
}

variable "cloudfront" {
  description = "CloudFront configuration"
  type = object({
    enabled = bool
    domains = list(string)
    regions = list(object({
      label = string
      full  = string
    }))
    logging = object({
      enabled         = bool
      include_cookies = bool
    })
    price_class = string
  })
}

variable "regional_origins" {
  description = "Map of regional origins with ALB and S3 bucket information"
  type = map(object({
    alb_dns_name                    = string
    alb_zone_id                     = string
    s3_bucket_id                    = string
    s3_bucket_arn                   = string
    s3_bucket_regional_domain_name  = string
  }))
}

variable "zone_id" {
  description = "Route53 hosted zone ID for DNS records"
  type        = string
}

variable "certificate_arn" {
  description = "ARN of the ACM certificate to use for CloudFront (must be in us-east-1)"
  type        = string
}

variable "waf_web_acl_arn" {
  description = "ARN of the WAF Web ACL to attach to CloudFront"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default     = {}
}
