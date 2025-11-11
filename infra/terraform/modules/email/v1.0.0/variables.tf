resource "random_id" "rnd" {
  byte_length = 12
}

variable "site" {
  type = object({
    label  = string
  })
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

locals {
  ses = "${var.site.label}/${var.region.label}/ses"
}
