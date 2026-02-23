# CloudWatch Dashboard for WAF Metrics
# Auto-generated per ruleset - shows blocks, allows, rate limits at a glance
# Dashboard appears in CloudWatch console in us-east-1 (where CLOUDFRONT WAF metrics live)

locals {
  # Dashboard metric building helpers
  dash_acl    = "${var.site_label}-${var.ruleset_name}"
  dash_region = "us-east-1" # CLOUDFRONT scope WAF metrics always here

  # Map rule name -> CloudWatch metric name
  dash_rule_metric = { for name in concat(
    [for r in var.custom_rules : r.name],
    [for r in var.managed_rules : r.name]
  ) : name => "${var.site_label}-${var.ruleset_name}-${name}" }

  # Categorize rules for dashboard sections
  dash_block_rules   = [for r in var.custom_rules : r.name if try(r.action, "") == "block"]
  dash_allow_rules   = [for r in var.custom_rules : r.name if try(r.action, "") == "allow"]
  dash_rate_rules    = [for r in var.custom_rules : r.name if try(r.action, "") == "block" && try(r.statement.rate_based_statement, null) != null]
  dash_managed_rules = [for r in var.managed_rules : r.name]

  # All sources of blocks (custom block rules + managed rules)
  dash_all_block_sources = concat(local.dash_block_rules, local.dash_managed_rules)
}

resource "aws_cloudwatch_dashboard" "waf" {
  count          = var.enabled ? 1 : 0
  dashboard_name = "${local.dash_acl}-waf"

  dashboard_body = jsonencode({
    periodOverride = "auto"
    widgets = concat(

      # ── Row 0: Summary Stats (24h totals) ──────────────────────────
      [
        {
          type   = "metric"
          x      = 0
          y      = 0
          width  = 8
          height = 4
          properties = {
            metrics = [
              ["AWS/WAFV2", "AllowedRequests", "WebACL", local.dash_acl, "Region", local.dash_region]
            ]
            view   = "singleValue"
            region = local.dash_region
            title  = "Allowed Requests (24h)"
            period = 86400
            stat   = "Sum"
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 0
          width  = 8
          height = 4
          properties = {
            metrics = [
              ["AWS/WAFV2", "BlockedRequests", "WebACL", local.dash_acl, "Region", local.dash_region]
            ]
            view   = "singleValue"
            region = local.dash_region
            title  = "Blocked Requests (24h)"
            period = 86400
            stat   = "Sum"
          }
        },
        {
          type   = "metric"
          x      = 16
          y      = 0
          width  = 8
          height = 4
          properties = {
            metrics = [
              ["AWS/WAFV2", "AllowedRequests", "WebACL", local.dash_acl, "Region", local.dash_region, { id = "a", visible = false }],
              ["AWS/WAFV2", "BlockedRequests", "WebACL", local.dash_acl, "Region", local.dash_region, { id = "b", visible = false }],
              [{ expression = "IF(a+b > 0, 100*b/(a+b), 0)", label = "Block Rate %", id = "rate" }]
            ]
            view   = "singleValue"
            region = local.dash_region
            title  = "Block Rate (24h)"
            period = 86400
            stat   = "Sum"
          }
        }
      ],

      # ── Row 1: Allowed vs Blocked Over Time ────────────────────────
      [
        {
          type   = "metric"
          x      = 0
          y      = 4
          width  = 24
          height = 6
          properties = {
            metrics = [
              ["AWS/WAFV2", "AllowedRequests", "WebACL", local.dash_acl, "Region", local.dash_region, { color = "#2ca02c", label = "Allowed" }],
              ["AWS/WAFV2", "BlockedRequests", "WebACL", local.dash_acl, "Region", local.dash_region, { color = "#d62728", label = "Blocked" }]
            ]
            view    = "timeSeries"
            stacked = false
            region  = local.dash_region
            title   = "Allowed vs Blocked Requests"
            period  = 300
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        }
      ],

      # ── Row 2: Blocks by Rule (stacked area) ──────────────────────
      length(local.dash_all_block_sources) > 0 ? [
        {
          type   = "metric"
          x      = 0
          y      = 10
          width  = 24
          height = 7
          properties = {
            metrics = [
              for name in local.dash_all_block_sources :
              ["AWS/WAFV2", "BlockedRequests", "WebACL", local.dash_acl, "Region", local.dash_region, "Rule", local.dash_rule_metric[name], { label = name }]
            ]
            view    = "timeSeries"
            stacked = true
            region  = local.dash_region
            title   = "Blocks by Rule"
            period  = 300
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        }
      ] : [],

      # ── Row 3 Left: Rate Limit Activity ────────────────────────────
      length(local.dash_rate_rules) > 0 ? [
        {
          type   = "metric"
          x      = 0
          y      = 17
          width  = 12
          height = 6
          properties = {
            metrics = [
              for name in local.dash_rate_rules :
              ["AWS/WAFV2", "BlockedRequests", "WebACL", local.dash_acl, "Region", local.dash_region, "Rule", local.dash_rule_metric[name], { label = name }]
            ]
            view    = "timeSeries"
            stacked = false
            region  = local.dash_region
            title   = "Rate Limit Blocks"
            period  = 300
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        }
      ] : [],

      # ── Row 3 Right: Allow Rule Traffic ────────────────────────────
      length(local.dash_allow_rules) > 0 ? [
        {
          type   = "metric"
          x      = length(local.dash_rate_rules) > 0 ? 12 : 0
          y      = 17
          width  = length(local.dash_rate_rules) > 0 ? 12 : 24
          height = 6
          properties = {
            metrics = [
              for name in local.dash_allow_rules :
              ["AWS/WAFV2", "AllowedRequests", "WebACL", local.dash_acl, "Region", local.dash_region, "Rule", local.dash_rule_metric[name], { label = name }]
            ]
            view    = "timeSeries"
            stacked = true
            region  = local.dash_region
            title   = "Traffic by Allow Rule"
            period  = 300
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        }
      ] : []
    )
  })
}
