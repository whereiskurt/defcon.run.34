variable "site" {
  type = object({
    label         = string
    random_suffix = optional(string, "")
  })
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
}

variable "dns" {
  type = object({
    zonename = string
  })
  description = "Apex DNS zone, e.g. defcon.run"
}

variable "alb_listener_arn" {
  type        = string
  description = "ARN of the ALB HTTPS listener to attach redirect rules to."
}

variable "alb_dns_name" {
  type        = string
  description = "DNS name of the ALB (ALIAS record target)."
}

variable "alb_zone_id" {
  type        = string
  description = "Canonical hosted-zone ID of the ALB (ALIAS record target)."
}

variable "zone_map" {
  description = "Route53 zone map from the site unit, keyed by zone name."
  type = map(object({
    zone_id      = string
    name         = string
    name_servers = optional(list(string), [])
  }))
}

variable "redirects" {
  description = "Host-based ALB redirect rules (no compute). host is the subdomain label under dns.zonename."
  type = list(object({
    host         = string
    target_host  = string
    target_path  = optional(string, "/")
    target_query = optional(string, "")
    status_code  = optional(string, "HTTP_302")
    priority     = number
  }))
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
