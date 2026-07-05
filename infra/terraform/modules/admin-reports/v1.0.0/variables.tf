variable "site_label" {
  description = "Site label used for resource naming/tagging (e.g. dc34)"
  type        = string
}

variable "log_group_names" {
  description = <<-EOT
    Map of app key -> exact existing CloudWatch Logs group name for the app that
    emits the DefconRun/Activity event stream. These are the ECS awslogs groups
    auto-created by ecs-task (naming `/ecs/{container.name}-{family}`), e.g.
    { auth = "/ecs/run-auth-app-run-auth", gpx = "/ecs/run-gpx-app-run-gpx",
      human = "/ecs/run-human-app-run-human" }.
    Metric filters attach to these groups; retention.tf adopts them via import{}.
    Discover the live names with:
      aws logs describe-log-groups --log-group-name-prefix /ecs/
  EOT
  type        = map(string)

  validation {
    condition     = alltrue([for k in ["auth", "gpx", "human"] : contains(keys(var.log_group_names), k)])
    error_message = "log_group_names must contain keys: auth, gpx, human."
  }
}

variable "metric_namespace" {
  description = "CloudWatch namespace the app-event metric filters publish into."
  type        = string
  default     = "DefconRun/Activity"
}

variable "log_retention_days" {
  description = "Retention (days) applied to the adopted /ecs/* app log groups."
  type        = number
  default     = 90
}

# --- Dashboard identifier inputs (40-06) --------------------------------------
# The dashboard (like modules/site/.../waf/dashboard.tf) cannot self-discover the
# ALB / CloudFront identifiers it plots — it takes them as INPUTS. The terragrunt
# unit populates these from `dependency` blocks on the network + ecs-service +
# cloudfront units so no widget/alarm dimension is ever an empty string.

variable "alb_arn_suffix" {
  description = <<-EOT
    The ALB's arn_suffix — the value of the CloudWatch AWS/ApplicationELB
    `LoadBalancer` dimension, shaped `app/<name>/<hash>` (i.e. the ALB arn with the
    `arn:...:loadbalancer/` prefix stripped). Fed by the network unit's alb_arn.
    An empty value leaves the ALB widgets/alarms in permanent INSUFFICIENT_DATA.
  EOT
  type        = string
  default     = ""
}

variable "target_group_arn_suffixes" {
  description = <<-EOT
    Map of target-group key -> arn_suffix (the CloudWatch `TargetGroup` dimension
    value, shaped `targetgroup/<name>/<hash>`). Fed by the ecs-service unit's
    target_groups output. Keys become dashboard widget labels.
  EOT
  type        = map(string)
  default     = {}
}

variable "cloudfront_distribution_ids" {
  description = <<-EOT
    Map of domain key -> CloudFront distribution id (the AWS/CloudFront
    `DistributionId` dimension) for the six domains auth/run/cms/gpx/flash/bib.
    CloudFront metrics live in us-east-1 (Region=Global). Fed by the cloudfront
    unit's distribution_ids output.
  EOT
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
