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

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
