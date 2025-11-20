variable "site" {
  description = "Site configuration"
  type = object({
    label         = string
    random_suffix = string
  })
}

variable "region" {
  description = "Region configuration"
  type = object({
    label = string
    full  = string
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

variable "tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "force_destroy" {
  description = "Allow destruction of S3 bucket even if not empty"
  type        = bool
  default     = true
}

variable "enable_versioning" {
  description = "Enable versioning on the S3 bucket"
  type        = bool
  default     = false
}

variable "enable_lifecycle_rules" {
  description = "Enable lifecycle rules for the S3 bucket"
  type        = bool
  default     = true
}

variable "cors_allowed_origins" {
  description = "List of allowed origins for CORS"
  type        = list(string)
  default     = ["*"]
}

variable "cloudfront_distribution_arn" {
  description = "ARN of CloudFront distribution to grant access (optional, for bucket policy)"
  type        = string
  default     = ""
}
