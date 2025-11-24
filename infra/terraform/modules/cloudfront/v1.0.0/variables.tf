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

variable "regional_origins_by_domain" {
  description = "Map of regional origins by domain, each containing ALB and S3 bucket information per region"
  type = map(map(object({
    alb_dns_name                   = string
    alb_zone_id                    = string
    s3_bucket_id                   = string
    s3_bucket_arn                  = string
    s3_bucket_regional_domain_name = string
  })))
}

variable "zone_map" {
  description = "Map of Route53 hosted zones by domain name"
  type = map(object({
    zone_id = string
    name    = string
  }))
}

variable "cert_map" {
  description = "Map of ACM certificates by domain name (must be in us-east-1 for CloudFront)"
  type = map(object({
    arn = string
  }))
}

variable "waf_web_acl_arns" {
  description = "Map of WAF Web ACL ARNs by domain name (e.g., 'run' => 'arn:...')"
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default     = {}
}
