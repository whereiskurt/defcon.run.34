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
  description = <<-EOT
    Host-based redirects. Each host is served as a small S3-hosted interstitial
    page behind its own CloudFront distribution: social crawlers read the og.*
    tags (the unfurl card); humans are redirected client-side to the target.

    og.image is an absolute URL (may be external, e.g. https://defcon.run/og.png).
    og.image_file, when set, uploads a local file from the module's assets/ dir to
    the host's S3 prefix — reference it in og.image as https://<host>.<zone>/<file>.
    priority is retained only for config compatibility and is unused here.
  EOT
  type = list(object({
    host         = string
    target_host  = string
    target_path  = optional(string, "/")
    target_query = optional(string, "")
    status_code  = optional(string, "HTTP_302")
    priority     = optional(number)
    og = object({
      title       = string
      description = string
      image       = string
      image_file  = optional(string)
    })
  }))
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
