resource "random_id" "rnd" {
  byte_length = 12
}

variable "site" {
  type = object({
    label         = string
    random_suffix = optional(string, "")
    skip_regions  = optional(list(string), [])
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

variable "zone_map" {
  type = map(object({
    zone_id      = string
    name         = string
    name_servers = list(string)
  }))
  description = "Map of Route53 zone information from site module"
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
    replica_regions = optional(list(object({
      label = string
      full  = string
    })), [])
  })
  description = "Email configuration from site level"
}

# These are extracted from var.email and passed separately by config.hcl
# to allow merging from site and region levels
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

variable "forwarder_lambda_source_path" {
  type        = string
  description = "Path to directory containing the email forwarder Lambda code (index.py). Required if fwd_rules is not empty."
  default     = ""
}

# S3-only receive rules. Unlike fwd_rules (which chain S3 + Lambda forwarding),
# these drop matching inbound mail into the received_emails bucket under a
# caller-supplied prefix and stop. Downstream consumers (e.g. Phase 22's Haiku
# Lambda for bib payment reconciliation) attach their own S3 event triggers
# scoped to the prefix — the prefix is a load-bearing cross-module contract.
variable "receive_rules" {
  type = list(object({
    name              = string
    match             = string
    object_key_prefix = string
  }))
  description = "List of s3-only SES receive rules (write raw email to received_emails bucket at the given prefix)."
  default     = []
}
