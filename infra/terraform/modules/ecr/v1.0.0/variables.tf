variable "site" {
  type = object({
    label         = string
    random_suffix = string
  })
  description = "Site configuration"
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
  description = "Region configuration"
}

variable "dns" {
  type = object({
    zonename   = string
    subdomains = list(string)
    ttl        = number
  })
  description = "DNS configuration"
}

variable "ecr" {
  type = list(object({
    name                 = string
    regions              = list(string)                  # List of regions to create this repository in
    image_tag_mutability = optional(string, "IMMUTABLE") # IMMUTABLE (recommended) or MUTABLE
    scan_on_push         = optional(bool, true)          # Scan images for vulnerabilities on push
    encryption_type      = optional(string, "AES256")    # AES256 or KMS
    kms_key              = optional(string, "")

    lifecycle_policy = optional(object({
      max_image_count = optional(number, 30)
      expire_days     = optional(number, 90)
    }), null)
  }))
  description = "List of ECR repository configurations with regions"
  default     = []
}
