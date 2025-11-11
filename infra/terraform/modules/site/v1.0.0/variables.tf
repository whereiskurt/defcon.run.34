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

variable "waf" {
  type = object({
    enabled  = bool
    log_mode = string
    rule_set = optional(string, "default")
  })
  description = "WAF configuration"

  validation {
    condition     = contains(["standard", "realtime"], var.waf.log_mode)
    error_message = "WAF mode must be either 'standard' or 'realtime'"
  }
}
