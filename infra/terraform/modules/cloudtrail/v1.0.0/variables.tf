variable "site" {
  type = object({
    label         = string
    random_suffix = string
  })
  description = "Site configuration"
}

variable "cloudtrail" {
  type = object({
    enabled                 = bool
    multi_region            = optional(bool, true)
    log_retention_days      = optional(number, 90)
    glacier_transition_days = optional(number, 0) # 0 = disabled
    enable_access_analyzer  = optional(bool, true)
    enable_athena           = optional(bool, true)
    enable_kms_encryption   = optional(bool, true)
    enable_alerts           = optional(bool, false)
    alert_email             = optional(string, "")
    monitor_roles = optional(list(string), [
      "terragrunt",
      "application",
      "readonly",
      "prowler",
      "e2e",
      "release",
      "deploy"
    ])
  })
  description = "CloudTrail configuration for IAM activity logging"
}
