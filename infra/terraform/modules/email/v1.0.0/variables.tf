variable "use_smtp_region" {
  default = false
}

variable "use_smtp_site" {
  default = false
}

resource "random_id" "rnd" {
  byte_length = 12
}

variable "site" {
  type = object({
    label  = string
  })
}

variable "dns" {
  type = object({
    zonename  = string
    subdomains = list(string)
    ttl        = optional(number, 300)
  })
  description = "DNS/Host configuration"
}

variable "region" {
  type = object({
    label  = string
    full  = string
  })
}

variable "email" {
  type = object({
    zonenames  = list(string)
    smtp_prefix  = string
  })
  description = "SMTP/email configuration"
}

variable "smtp_credentials" {
  type = list(string)
  description = "List of email addresses to create SMTP credentials for"
  default = []
}

variable "email_forwarding" {
  type = list(object({
    from_address = string
    to_address   = string
  }))
  description = "List of email forwarding rules. Each rule forwards from a custom domain address to a Gmail/public address."
  default     = []
}