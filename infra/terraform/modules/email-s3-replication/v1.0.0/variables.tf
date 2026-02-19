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

variable "source_bucket" {
  description = "Source S3 bucket info from email module outputs"
  type = object({
    name = string
    arn  = string
  })
}

variable "email" {
  description = "Email configuration (replica_regions used for replication targets)"
  type = object({
    replica_regions = list(object({
      label = string
      full  = string
    }))
  })
}
