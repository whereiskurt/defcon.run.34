variable "dns" {
  type = object({
    zonename   = string
    subdomains = list(string)
  })
  description = "DNS configuration"
}

variable "zone_map" {
  type = map(object({
    zone_id      = string
    name         = string
    name_servers = list(string)
  }))
  description = "Map of Route53 zone information from site module"
}

variable "make_site_cert" {
  type        = bool
  default     = true
  description = "Whether to create a certificate for var.dns.zonename with all subdomains as SANs"
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
  description = "Region configuration with label and full name"
}
