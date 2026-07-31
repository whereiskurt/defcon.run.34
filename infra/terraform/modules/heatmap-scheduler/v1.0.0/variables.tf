# Variables for heatmap-scheduler v1.0.0 (multi-schedule + timezone).
# Copied from strava-sync-scheduler v1.1.0: a schedules map (one
# aws_scheduler_schedule per entry, all invoking the same Lambda) plus an
# explicit IANA timezone applied to all of them.

variable "region" {
  description = "Region object with a .label (e.g. use1), per repo convention."
  type        = any
}

variable "site" {
  description = "Site object with a .label."
  type        = any
}

variable "sync_url" {
  description = "run.gpx internal heat-map build endpoint. Must resolve to the VPC-private AWS Cloud Map / ECS service-discovery DNS name, e.g. http://run-gpx.app-use1-dc34.local:3000/use1/api/gpx/internal/heatmap-build — the public gpx.<domain> host must NEVER be used here (the public ALB is CloudFront-only and a Lambda cannot reach it directly; see the live unit's header comment)."
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

variable "ssm_kms_key_alias" {
  description = "KMS key alias used to encrypt SSM SecureString parameters for the site (needed for kms:Decrypt on ssm:GetParameter with WithDecryption=true). Supports the {region_label} placeholder, substituted with var.region.label."
  type        = string
  default     = "alias/dc34-ssm-{region_label}"
}

variable "schedules" {
  description = "Map of schedule name (arbitrary key, e.g. \"hourly\") to EventBridge Scheduler expression (e.g. \"cron(0 * 5-10 8 ? 2026)\"). One aws_scheduler_schedule is created per entry, all invoking the same Lambda."
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
  description = "Lambda timeout in seconds — the OUTERMOST of three strictly increasing bounds. It MUST be strictly greater than the invoker's own fetch abort (lambda/index.mjs), which MUST in turn be strictly greater than the builder's internal wall-clock deadline (BUILD_BUDGET_MS in apps/run.gpx/webapp/src/lib/heatmap-build.ts) — the builder's deadline is the only bound the build itself enforces. Equal is NOT enough: this budget must also absorb the SSM GetParameter round trip, cold start, DNS and connection setup on top of the fetch bound. If it does not, the invoker is killed mid-flight, it throws, and the schedule's retry_policy fires further invocations that each start a fresh full rebuild while the first is still scanning. An earlier description stated a contract against a Next.js route-level duration export; that export was inert under output: \"standalone\" on ECS Fargate and has since been removed, so it is not the bound to code against."
  type        = number
  default     = 300
}

variable "lambda_memory_size" {
  type    = number
  default = 256
}

variable "log_retention_days" {
  type    = number
  default = 14
}
