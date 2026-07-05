# =============================================================================
# 90-day retention on the existing /ecs/* app log groups (AR-08a)
#
# RISK / RESOLUTION: these groups ALREADY EXIST because ecs-task runs with
# `awslogs-create-group = "true"`, and they currently have no retention. A plain
# aws_cloudwatch_log_group for the same names would error on apply
# ("group already exists") and a naive replace would destroy live groups
# (threat T-40-11, high). Resolution (least disruptive — no ECS change, no
# service restart): declare the group with only `retention_in_days` set and
# ADOPT the existing group into state via a Terraform import{} block. Apply then
# only sets retention; it never destroys/recreates. `prevent_destroy` guards the
# live groups against an accidental future replace.
#
# Do NOT flip awslogs-create-group in ecs-task and do NOT pre-delete the groups.
# =============================================================================

resource "aws_cloudwatch_log_group" "app" {
  for_each = var.log_group_names

  name              = each.value
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, {
    Name      = each.value
    App       = each.key
    Component = "admin-reports"
    ManagedBy = "terragrunt"
  })

  lifecycle {
    prevent_destroy = true
  }
}

# Adopt the ECS-auto-created groups (by exact name) so retention is applied to
# the running groups instead of creating new ones. for_each import requires
# Terraform >= 1.7 (repo runs 1.14).
import {
  for_each = var.log_group_names

  to = aws_cloudwatch_log_group.app[each.key]
  id = each.value
}
