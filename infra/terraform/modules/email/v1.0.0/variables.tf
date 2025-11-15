resource "random_id" "rnd" {
  byte_length = 12
}

variable "site" {
  type = object({
    label = string
  })
}

variable "dns" {
  type = object({
    zonename   = string
    subdomains = list(string)
    ttl        = optional(number, 300)
  })
  description = "DNS/Host configuration"
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
}

variable "email" {
  type = object({
    ## example.com
    make_site_domain = optional(bool, true)
    ## use1.example.com
    make_regional_domains = optional(bool, true)
    # email.example.com
    make_domains = optional(bool, true)

    primary_region = string
    zonenames      = list(string)
    smtp_prefix    = string
    smtp_iam_users = list(string)
    fwd_rules = list(object({
      match   = string
      send_to = string
    }))
  })
  description = "Email configuration from site level"
}

variable "smtp_iam_users" {
  type        = list(string)
  description = "List of email addresses to create SMTP credentials for"
  default     = []
}

variable "fwd_rules" {
  type = list(object({
    match   = string
    send_to = string
  }))
  description = "List of email forwarding rules. Each rule forwards from a custom domain address to a Gmail/public address."
  default     = []
}

variable "zone_map" {
  type = map(object({
    zone_id      = string
    name         = string
    name_servers = list(string)
  }))
  description = "Map of Route53 zone information from site module"
}
