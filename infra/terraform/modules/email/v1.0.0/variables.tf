variable "conf" {

  type = object({
    ## example.com
    make_site_domain = optional(bool, false)
    ## use1.example.com
    make_regional_domains = optional(bool, false)
    # email.example.com
    make_domains = optional(bool, false)

  })
  default = {
    make_site_domain      = true
    make_regional_domains = true
    make_domains          = true
  }
  description = "SMTP configuration settings"
}

resource "random_id" "rnd" {
  byte_length = 12
}

variable "site" {
  type = object({
    label          = string
    primary_region = string
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
    zonenames   = list(string)
    smtp_prefix = string
  })
  description = "SMTP/email configuration"
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
