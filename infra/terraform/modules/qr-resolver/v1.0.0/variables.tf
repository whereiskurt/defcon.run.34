variable "site" {
  description = "Site-level configuration."
  type = object({
    label         = string
    random_suffix = optional(string, "")
    skip_regions  = optional(list(string), [])
  })
}

variable "region" {
  description = "Region configuration. The resolver is single-region (us-east-1) but region-AWARE (it emits /use1//cac1/ run.human paths)."
  type = object({
    label = string
    full  = string
  })
}

# --- Lambda source ---------------------------------------------------------

variable "resolver_source_path" {
  description = "Filesystem path to the resolver Lambda source dir (contains index.mjs + node_modules/). The consuming unit runs `npm ci --omit=dev` first — Terraform does not npm-install."
  type        = string
}

variable "rollup_source_path" {
  description = "Filesystem path to the rollup Lambda source dir (contains index.mjs + node_modules/)."
  type        = string
}

# --- Shared data layer -----------------------------------------------------

variable "electro_table_name" {
  description = "Name of the shared run-human-electro DynamoDB global table holding qr/ctf/qrstat entities."
  type        = string
  default     = "run-human-electro"
}

variable "electro_table_arn" {
  description = "ARN of the shared run-human-electro table (for GetItem/UpdateItem IAM scope, including GSIs)."
  type        = string
}

# --- Analytics -------------------------------------------------------------

variable "rollup_schedule_expression" {
  description = "EventBridge schedule for the analytics rollup. Default every 30 minutes per the design spec."
  type        = string
  default     = "rate(30 minutes)"
}

variable "flush_token_ssm_arn" {
  description = "ARN of the SSM SecureString holding the X-QR-Flush-Token secret for the on-demand /_flush path. Empty disables the flush IAM grant (cron-only rollup)."
  type        = string
  default     = ""
}

variable "ssm_kms_key_alias" {
  description = "KMS key alias that encrypts the flush-token SSM SecureString (for kms:Decrypt on GetParameter WithDecryption)."
  type        = string
  default     = "alias/dc34-ssm-{region_label}"
}

# --- Lambda knobs ----------------------------------------------------------

variable "lambda_runtime" {
  description = "Node.js Lambda runtime label."
  type        = string
  default     = "nodejs22.x"
}

variable "resolver_timeout" {
  description = "Resolver timeout (seconds). One DynamoDB GetItem + string work; fast."
  type        = number
  default     = 5
}

variable "resolver_memory_size" {
  description = "Resolver memory (MB). Tiny, CPU-light path."
  type        = number
  default     = 256
}

variable "rollup_timeout" {
  description = "Rollup timeout (seconds). Logs Insights StartQuery + poll can take a while."
  type        = number
  default     = 120
}

variable "rollup_memory_size" {
  description = "Rollup memory (MB)."
  type        = number
  default     = 256
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for both Lambda log groups. Resolver logs feed the rollup, so keep at least a couple rollup windows."
  type        = number
  default     = 14
}

variable "extra_environment" {
  description = "Additional env vars merged into the resolver Lambda (feature flags, region default overrides)."
  type        = map(string)
  default     = {}
}

variable "test_token_enabled" {
  description = "Create an SSM SecureString test token and inject it as the resolver's QR_TEST_TOKEN. A scan carrying `x-qr-test: <token>` then redirects normally but is NOT logged/counted — for operators to verify a live code without polluting analytics. Read the token from the SSM param name this module outputs."
  type        = bool
  default     = false
}

# --- Transport (PENDING DECISION 1 — see README + spec-corrections doc) -----

variable "enable_transport" {
  description = <<-EOT
    Master switch for the public reachability wiring (ALB->Lambda target group
    + listener rule). DEFAULT false: the public ALB accepts 443 only from the
    CloudFront prefix list, so this MUST be fronted by a CloudFront distro for
    q.defcon.run (Decision 1 = A). Leave false until that decision is confirmed
    and the CloudFront distro is authored. When false the Lambdas + IAM + cron
    still plan/apply cleanly; only the ingress is withheld.
  EOT
  type        = bool
  default     = false
}

variable "alb_listener_arn" {
  description = "ARN of the public ALB HTTPS listener to attach the q.defcon.run host rule to. Only used when enable_transport = true."
  type        = string
  default     = ""
}

variable "alb_listener_rule_priority" {
  description = "Priority for the q.defcon.run listener rule. Only used when enable_transport = true."
  type        = number
  default     = 400
}

variable "resolver_host" {
  description = "Public host the resolver answers on."
  type        = string
  default     = "q.defcon.run"
}

variable "alb_dns_name" {
  description = "DNS name of the public ALB, used as the CloudFront origin domain. Only used when enable_transport = true."
  type        = string
  default     = ""
}

variable "cert_arn" {
  description = "ARN of the us-east-1 ACM cert covering the resolver host (rides the *.defcon.run wildcard SAN). CloudFront requires the cert in us-east-1. Only used when enable_transport = true."
  type        = string
  default     = ""
}

variable "zone_id" {
  description = "Route53 hosted-zone id of the apex defcon.run zone for the q. ALIAS record. Only used when enable_transport = true."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags merged onto the CloudFront distribution."
  type        = map(string)
  default     = {}
}
