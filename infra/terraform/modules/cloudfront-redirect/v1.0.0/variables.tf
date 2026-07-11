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

variable "cert_map" {
  description = "ACM cert map from the us-east-1 certs unit, keyed by domain name. The vanity hosts ride the wildcard *.defcon.run SAN on the primary cert, keyed by the apex zonename. CloudFront requires the cert in us-east-1."
  type        = map(object({ arn = string }))
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
  description = "Host-based edge redirects. host is the subdomain label under dns.zonename. priority is unused by the CloudFront edge implementation and retained only for config compatibility with the redirects list."
  type = list(object({
    host         = string
    target_host  = string
    target_path  = optional(string, "/")
    target_query = optional(string, "")
    status_code  = optional(string, "HTTP_302")
    priority     = optional(number)
  }))
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
