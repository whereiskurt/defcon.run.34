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

variable "source_buckets" {
  description = "Map of upload name => bucket info from s3-uploads module outputs"
  type = map(object({
    name   = string
    arn    = string
    region = string
  }))
}

variable "user_uploads" {
  description = "User upload bucket configurations (same schema as s3-uploads)"
  type = list(object({
    name         = string
    service_name = string
    regions      = list(string)

    replication = object({
      enabled = bool
      replica_regions = list(object({
        label = string
        full  = string
      }))
    })
  }))
  default = []
}
