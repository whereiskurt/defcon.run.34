variable "site" {
  description = "Site-level configuration"
  type = object({
    label         = string
    random_suffix = optional(string, "")
    skip_regions  = optional(list(string), [])
  })
}

variable "region" {
  description = "Region configuration"
  type = object({
    label = string
    full  = string
  })
}

variable "source_path" {
  description = "Filesystem path to the Node.js Lambda source directory (contains index.mjs + node_modules/)."
  type        = string
}

variable "ses_inbox_bucket_name" {
  description = "Name of the SES inbox S3 bucket that receives raw MIME messages at the bib-payments/ prefix (Phase 20 email module output: received_emails_bucket_name)."
  type        = string
}

variable "ses_inbox_bucket_arn" {
  description = "ARN of the SES inbox S3 bucket (Phase 20 email module output: received_emails_bucket_arn)."
  type        = string
}

variable "object_key_prefix" {
  description = "S3 object key prefix to trigger on. Contract with Phase 20 SES receive rule (email.hcl locals.receive_rules[0].object_key_prefix)."
  type        = string
  default     = "bib-payments/"
}

variable "electro_table_name" {
  description = "Name of the shared run-human-electro DynamoDB table used by BibReconcile + Bib + BudgetCounter entities."
  type        = string
}

variable "electro_table_arn" {
  description = "ARN of the shared run-human-electro DynamoDB table (for GetItem / UpdateItem / Query IAM scope, including the runnerCode-index GSI)."
  type        = string
}

variable "ssm_bib_prefix" {
  description = "SSM parameter path prefix for bib service secrets. Lambda reads /dc34/secrets/{region_label}/bib/anthropic/api_key from within this prefix."
  type        = string
  default     = "/dc34/secrets/{region_label}/bib"
}

variable "ssm_kms_key_alias" {
  description = "KMS key alias used to encrypt SSM SecureString parameters for the site (needed for kms:Decrypt on ssm:GetParameter with WithDecryption=true)."
  type        = string
  default     = "alias/dc34-ssm-{region_label}"
}

variable "ses_from_address" {
  description = "Verified SES sender identity used by the reconciliation Lambda when it emails the admin about unmatched/ambiguous receipts. Must be a verified domain identity (Phase 20 provisioned bibpayment@run.<domain>)."
  type        = string
  default     = "bibpayment@run.defcon.run"
}

variable "ses_admin_recipient" {
  description = "Destination address for admin-notification emails on unmatched / ambiguous receipts (Phase 22-04-03 SES:SendEmail target)."
  type        = string
  default     = "defcon.run@gmail.com"
}

variable "anthropic_api_key_ssm_arn" {
  description = "Full ARN of the SSM parameter that stores the Anthropic API key. When set, IAM scopes GetParameter narrowly to this ARN instead of the broader ssm_bib_prefix wildcard. Leave empty to fall back to the ssm_bib_prefix/anthropic/* pattern."
  type        = string
  default     = ""
}

variable "lambda_runtime" {
  description = "Node.js Lambda runtime label."
  type        = string
  default     = "nodejs22.x"
}

variable "lambda_timeout" {
  description = "Lambda execution timeout in seconds. Anthropic SDK client-side timeout is 25s (per AI-SPEC); +5s cushion here."
  type        = number
  default     = 30
}

variable "lambda_memory_size" {
  description = "Lambda memory in MB. Reconciliation is JSON + HTTP heavy, low CPU."
  type        = number
  default     = 512
}

variable "reserved_concurrent_executions" {
  description = "Reserved concurrency. Low value throttles a burst of SES receipts so a 30% price hike or a prompt-injection loop cannot blow the $20/day Haiku cap in seconds."
  type        = number
  default     = 5
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the Lambda log group."
  type        = number
  default     = 14
}

variable "extra_environment" {
  description = "Additional environment variables to inject into the Lambda (test overrides, feature flags)."
  type        = map(string)
  default     = {}
}
