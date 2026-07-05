# =============================================================================
# abuse-detection module — variable contract (Phase 41)
#
# This file declares the COMPLETE variable contract for the whole phase.
# Plans 03/04/05 only ADD new resource files (lambda.tf, wiring, etc.); they
# MUST NOT edit this file. Every knob a later plan needs is declared here now.
#
# NOTE (Phase 40 lesson): do NOT declare a provider-requirements block anywhere in
# this module. The terragrunt `include "providers"` generates provider.tf with the
# provider requirements; a second declaration errors with
# "Duplicate required providers configuration". The `archive` provider used by
# the archive_file data source (Plan 03) auto-installs.
# =============================================================================

# --- Identity objects (repo convention: type = any, accessed via .label) ------

variable "site" {
  description = "Site object with a .label (e.g. dc34) and a .random_suffix used for globally-unique bucket names."
  type        = any
}

variable "region" {
  description = "Region object with a .label (e.g. use1) and a .full (e.g. us-east-1). This module is us-east-1 only."
  type        = any
}

# --- ALB access-log source (AD-01) --------------------------------------------

variable "alb_logs_bucket_name" {
  description = <<-EOT
    The REAL existing ALB access-log S3 bucket name. This is DERIVED — wired in
    Plan 05 from the network unit's `alb_logs_bucket_name` output — and must NEVER
    be guessed/hardcoded. Guessing the bucket name was the exact Phase 40 defect
    (#2) this contract avoids: the Glue table's storage.location.template points
    at whatever this variable resolves to.
  EOT
  type        = string
}

variable "alb_logs_prefix" {
  description = "The ALB access_logs prefix configured on the load balancer (network/alb.tf sets `access`)."
  type        = string
  default     = "access"
}

# --- Athena workgroup guardrail (AD-02) ---------------------------------------

variable "athena_bytes_scanned_cutoff" {
  description = "Per-query bytes-scanned cap for the dcr-abuse-analysis workgroup (runaway-scan guardrail). Default 10 GiB."
  type        = number
  default     = 10737418240
}

variable "projection_start_date" {
  description = "Partition-projection lower bound in yyyy/MM/dd. Bounds the projected `day` range so Athena never enumerates partitions before the deployment window."
  type        = string
  default     = "2026/01/01"
}

# --- Detection thresholds (consumed by Plans 03/04, surfaced from site.hcl in
#     Plan 05). Tight pre-con defaults: legit traffic ~= 0, so a hit is signal. --

variable "cron_minutes" {
  description = "EventBridge cron cadence in minutes for the abuse-detector Lambda (AD-05)."
  type        = number
  default     = 30
}

variable "lookback_hours" {
  description = "How many hours of recent partitions each run scans (cost control)."
  type        = number
  default     = 3
}

variable "session_hours" {
  description = "Sustained-activity threshold (AD-03): flag IPs whose max session span >= this many hours."
  type        = number
  default     = 2
}

variable "session_gap_min" {
  description = "Sessionization gap (AD-03): start a new session when the gap since the previous request exceeds this many minutes."
  type        = number
  default     = 15
}

variable "posts_per_5min" {
  description = "Rate-outlier threshold (AD-04): flag IPs whose peak 5-min bucket exceeds this many POSTs."
  type        = number
  default     = 30
}

variable "requests_per_5min" {
  description = "Rate-outlier threshold (AD-04): flag IPs whose peak 5-min bucket exceeds this many total requests."
  type        = number
  default     = 100
}

variable "escalation_multiplier" {
  description = "Re-alert an already-flagged offender when their counts cross this multiple of the threshold (AD-06 escalation)."
  type        = number
  default     = 3
}

variable "digest_hour_utc" {
  description = "UTC hour at which the daily human digest email is sent (AD-07)."
  type        = number
  default     = 13
}

# --- Alerting reuse (AD-06) ---------------------------------------------------

variable "sns_topic_name" {
  description = <<-EOT
    The Phase 40 SNS topic to REUSE for operator alerts. The module composes the
    topic ARN internally from account id + region + this name; it MUST NOT create
    a second topic.
  EOT
  type        = string
  default     = "dcr-admin-reports-tripwire"
}

# --- Gate + Lambda knobs (AD-08) ----------------------------------------------

variable "schedule_enabled" {
  description = "Ships dark (AD-08): the EventBridge rule state derives from this in Plan 03. Default false — enable deliberately after a manual Athena query confirms the ALB-log schema parses."
  type        = bool
  default     = false
}

variable "lambda_runtime" {
  description = "Lambda runtime for the abuse-detector (repo convention: Node)."
  type        = string
  default     = "nodejs20.x"
}

variable "lambda_timeout" {
  description = "Lambda timeout (seconds). Athena is invoked async, so this bounds orchestration, not query duration."
  type        = number
  default     = 120
}

variable "lambda_memory_size" {
  description = "Lambda memory (MB)."
  type        = number
  default     = 256
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention (days) for the Lambda log group."
  type        = number
  default     = 14
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
