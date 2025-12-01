variable "site_label" {
  description = "Label for the site"
  type        = string
}

variable "ruleset_name" {
  description = "Name of the WAF ruleset"
  type        = string
}

variable "log_mode" {
  description = "WAF logging mode (standard or realtime)"
  type        = string

  validation {
    condition     = contains(["standard", "realtime"], var.log_mode)
    error_message = "WAF mode must be either 'standard' or 'realtime'"
  }
}

variable "managed_rules" {
  description = "List of AWS managed rule groups to include"
  type = list(object({
    name                = string
    vendor_name         = string
    priority            = number
    override_action     = optional(string, "none")
    excluded_rules      = optional(list(string), [])
    scope_down_statement = optional(any, null)
  }))
  default = []
}

variable "custom_rules" {
  description = "List of custom WAF rules with heterogeneous statement types"
  type        = any
  default     = []
}

variable "enabled" {
  description = "Whether this WAF ruleset is enabled"
  type        = bool
  default     = true
}

variable "custom_response_bodies" {
  description = "Map of custom response bodies for blocked requests"
  type = map(object({
    content      = string
    content_type = string # TEXT_PLAIN, TEXT_HTML, APPLICATION_JSON
  }))
  default = {}
}
