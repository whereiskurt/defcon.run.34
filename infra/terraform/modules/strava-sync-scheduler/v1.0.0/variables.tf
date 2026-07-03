# Variables for strava-sync-scheduler (v1.7 Phase 33). DRAFT.

variable "region" {
  description = "Region object with a .label (e.g. use1), per repo convention."
  type        = any
}

variable "site" {
  description = "Site object with a .label."
  type        = any
}

variable "sync_url" {
  description = "run.gpx internal sync endpoint, e.g. https://gpx.<domain>/<region>/api/gpx/internal/strava-sync"
  type        = string
}

variable "internal_sync_secret_ssm_path" {
  description = "SSM parameter NAME of the shared internal secret."
  type        = string
}

variable "internal_sync_secret_ssm_arn" {
  description = "SSM parameter ARN of the shared internal secret (for IAM scoping)."
  type        = string
}

variable "schedule_expression" {
  description = "EventBridge Scheduler expression, e.g. rate(6 hours)."
  type        = string
  default     = "rate(6 hours)"
}

variable "schedule_enabled" {
  description = "Whether the schedule is ENABLED."
  type        = bool
  default     = true
}

variable "lambda_runtime" {
  type    = string
  default = "nodejs20.x"
}

variable "lambda_timeout" {
  type    = number
  default = 120
}

variable "lambda_memory_size" {
  type    = number
  default = 256
}

variable "log_retention_days" {
  type    = number
  default = 14
}
