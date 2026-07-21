# Variables for strava-sync-scheduler v1.1.0 (multi-schedule + timezone).
# v1.0.0 supported a single UTC schedule; v1.1.0 replaces schedule_expression
# with a schedules map (one aws_scheduler_schedule per entry, all invoking the
# same Lambda) plus an explicit IANA timezone applied to all of them.

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

variable "schedules" {
  description = "Map of schedule name (arbitrary key, e.g. \"morning\") to EventBridge Scheduler expression (e.g. \"cron(0 10 * * ? *)\"). One aws_scheduler_schedule is created per entry, all invoking the same Lambda."
  type        = map(string)
  default     = {}
}

variable "schedule_expression_timezone" {
  description = "IANA timezone applied to every entry in var.schedules (e.g. \"America/Los_Angeles\"). EventBridge Scheduler evaluates cron/rate expressions in this timezone."
  type        = string
  default     = "UTC"
}

variable "schedule_enabled" {
  description = "Whether the schedules are ENABLED."
  type        = bool
  default     = true
}

variable "vpc_subnet_ids" {
  description = "Subnet IDs for the Lambda's VPC attachment. Required whenever sync_url resolves to a VPC-private address (e.g. an AWS Cloud Map / ECS service-discovery private DNS namespace) that a no-VPC Lambda cannot reach. Leave empty ([]) to run the Lambda without a VPC config (e.g. if sync_url is a public, internet-reachable endpoint)."
  type        = list(string)
  default     = []
}

variable "vpc_security_group_ids" {
  description = "Security group IDs attached to the Lambda's ENIs when vpc_subnet_ids is non-empty. Must include (or be covered by) whatever security group the sync_url target accepts inbound traffic from — e.g. a self-referencing SG shared with the target ECS service."
  type        = list(string)
  default     = []
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
