variable "site" {
  description = "Site-level configuration"
  type = object({
    label         = string
    random_suffix = string
    skip_regions  = list(string)
  })
}

variable "region" {
  description = "Region configuration"
  type = object({
    label = string
    full  = string
  })
}

variable "user_uploads" {
  description = "User upload bucket configurations"
  type = list(object({
    name         = string       # Bucket identifier, e.g., "run-human"
    service_name = string       # Associated ECS service name
    regions      = list(string) # Deployment regions (full names)

    lifecycle = object({
      uploads_expire_days   = number # Days before uploads/* objects expire (0 = never)
      processed_expire_days = number # Days before processed/* objects expire (0 = never)
      enable_versioning     = bool   # Enable S3 versioning
    })

    replication = object({
      enabled = bool # Enable cross-region replication
      replica_regions = list(object({
        label = string # Region label (e.g., "use1")
        full  = string # Full region name (e.g., "us-east-1")
      }))
    })

    # Future: SNS notifications for upload events
    notifications = optional(object({
      enabled       = optional(bool, false)
      sns_topic_arn = optional(string)
      events        = optional(list(string), ["s3:ObjectCreated:*"])
    }))

    # CORS configuration for browser uploads
    cors = optional(object({
      allowed_origins = optional(list(string), ["*"])
      allowed_methods = optional(list(string), ["GET", "PUT", "POST", "HEAD"])
      allowed_headers = optional(list(string), ["*"])
      expose_headers  = optional(list(string), ["ETag"])
      max_age_seconds = optional(number, 3600)
    }))

    # Full bucket access mode (for services like Litestream that need unrestricted access)
    # When true, IAM policy grants full S3 access to entire bucket instead of prefix-restricted
    full_bucket_access = optional(bool, false)
  }))
  default = []
}
