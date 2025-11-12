locals {
  ses = "${var.site.label}/${var.region.label}/ses"
  region_zonename = "${var.region.label}.${var.email.zonename}"
  smtp_zonename = "${var.email.smtp_prefix}.${var.region.label}.${var.email.zonename}"
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
    zonename  = string
    smtp_prefix  = string
  })
  description = "SMTP/email configuration"
}