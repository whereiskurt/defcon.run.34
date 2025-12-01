resource "random_id" "rnd" {
  byte_length = 8
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

variable "waf" {
  type = any
  description = "WAF configuration with multiple rulesets. Each ruleset should contain: enabled (bool), managed_rules (list), custom_rules (list), custom_response_bodies (map)"

  validation {
    condition     = contains(["standard", "realtime"], var.waf.log_mode)
    error_message = "WAF mode must be either 'standard' or 'realtime'"
  }
}
