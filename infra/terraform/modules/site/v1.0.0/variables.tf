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
  type = object({
    enabled  = bool
    log_mode = string
    rulesets = optional(map(object({
      enabled = optional(bool, true)
      managed_rules = optional(list(object({
        name                = string
        vendor_name         = string
        priority            = number
        override_action     = optional(string, "none")
        excluded_rules      = optional(list(string), [])
        scope_down_statement = optional(any, null)
      })), [])
      custom_rules = optional(list(object({
        name            = string
        priority        = number
        action          = string
        statement       = any
        visibility_config = optional(object({
          cloudwatch_metrics_enabled = optional(bool, true)
          sampled_requests_enabled   = optional(bool, true)
        }), {})
      })), [])
    })), {})
  })
  description = "WAF configuration with multiple rulesets"

  validation {
    condition     = contains(["standard", "realtime"], var.waf.log_mode)
    error_message = "WAF mode must be either 'standard' or 'realtime'"
  }
}
