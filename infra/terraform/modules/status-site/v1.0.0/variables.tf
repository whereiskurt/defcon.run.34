variable "site" {
  description = "Site configuration"
  type = object({
    label = string
  })
}

variable "dns" {
  description = "DNS configuration"
  type = object({
    zonename = string
  })
}

variable "subdomain" {
  description = "Subdomain for the status site (status.<zonename>)"
  type        = string
  default     = "status"
}

variable "region_label" {
  description = "Short region label used as the content path prefix (e.g. use1)"
  type        = string
  default     = "use1"
}

variable "apex_zone_id" {
  description = "Route53 hosted zone id for the apex zone (lives in the management account)"
  type        = string
}

variable "price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"
}

variable "json_default_ttl" {
  description = "Default TTL (seconds) for *.json (short so status updates propagate fast)"
  type        = number
  default     = 30
}

variable "json_max_ttl" {
  description = "Max TTL (seconds) for *.json"
  type        = number
  default     = 60
}

variable "tags" {
  description = "Common tags"
  type        = map(string)
  default     = {}
}
