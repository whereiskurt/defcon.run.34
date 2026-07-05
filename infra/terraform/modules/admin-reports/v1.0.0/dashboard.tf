# =============================================================================
# admin-reports CloudWatch dashboard (AR-05)
#
# Mirrors the widget/jsonencode pattern of modules/site/v1.0.0/waf/dashboard.tf.
# Like that dashboard, it plots resource identifiers it is GIVEN as inputs
# (var.alb_arn_suffix / var.target_group_arn_suffixes / var.cloudfront_distribution_ids)
# — it does NOT self-discover them. The terragrunt unit wires those from the
# network + ecs-service + cloudfront units, so no ALB/CloudFront widget resolves
# to an empty dimension.
#
# Namespace for the custom app-event series is var.metric_namespace
# (DefconRun/Activity — the Signups/Logins/GpxUploads/... metrics from 40-04).
# =============================================================================

locals {
  dash_region = "us-east-1" # ALB metrics + CloudFront (Region=Global) metrics both surface in us-east-1

  # `SOURCE '<group>'` clause across every app /ecs/* group, for the Logs Insights widgets.
  dash_logs_source = join(" ", [for g in values(var.log_group_names) : "SOURCE '${g}'"])
}

resource "aws_cloudwatch_dashboard" "admin_reports" {
  dashboard_name = "admin-reports"

  dashboard_body = jsonencode({
    periodOverride = "auto"
    widgets = concat(

      # ── Row 0: HEADLINE — distinct active users, last hour ─────────────
      # The single most-important number: how many humans are actually here now.
      [
        {
          type   = "log"
          x      = 0
          y      = 0
          width  = 12
          height = 6
          properties = {
            query   = "${local.dash_logs_source} | filter ispresent(userId) | stats count_distinct(userId) as distinct_users by bin(1h)"
            region  = local.dash_region
            stacked = false
            view    = "bar"
            title   = "Distinct Active Users (per hour, last hour is the headline)"
          }
        },
        {
          type   = "log"
          x      = 12
          y      = 0
          width  = 12
          height = 6
          properties = {
            query   = "${local.dash_logs_source} | filter ispresent(ip) | stats count(*) as events by ip | sort events desc | limit 20"
            region  = local.dash_region
            stacked = false
            view    = "table"
            title   = "Top IPs by Event Count"
          }
        }
      ],

      # ── Row 1: DefconRun/Activity app events (stacked, per hour) ────────
      [
        {
          type   = "metric"
          x      = 0
          y      = 6
          width  = 24
          height = 6
          properties = {
            metrics = [
              [var.metric_namespace, "Signups", { label = "Signups" }],
              [var.metric_namespace, "Logins", { label = "Logins" }],
              [var.metric_namespace, "GpxUploads", { label = "GpxUploads" }],
              [var.metric_namespace, "GpxShares", { label = "GpxShares" }],
              [var.metric_namespace, "MapViews", { label = "MapViews" }],
              [var.metric_namespace, "Checkins", { label = "Checkins" }],
              [var.metric_namespace, "Uploads", { label = "Uploads" }]
            ]
            view    = "timeSeries"
            stacked = true
            region  = local.dash_region
            title   = "App Activity Events (DefconRun/Activity, per hour)"
            period  = 3600
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        }
      ],

      # ── Row 2: ALB per-target-group RequestCount + TargetResponseTime ──
      [
        {
          type   = "metric"
          x      = 0
          y      = 12
          width  = 12
          height = 6
          properties = {
            metrics = [
              for k, tg in var.target_group_arn_suffixes :
              ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", tg, { label = k }]
            ]
            view    = "timeSeries"
            stacked = false
            region  = local.dash_region
            title   = "ALB RequestCount by Target Group"
            period  = 300
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 12
          width  = 12
          height = 6
          properties = {
            metrics = [
              for k, tg in var.target_group_arn_suffixes :
              ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", tg, { label = k }]
            ]
            view    = "timeSeries"
            stacked = false
            region  = local.dash_region
            title   = "ALB TargetResponseTime by Target Group"
            period  = 300
            stat    = "Average"
            yAxis   = { left = { min = 0 } }
          }
        }
      ],

      # ── Row 3: ALB per-target-group 4XX / 5XX ──────────────────────────
      [
        {
          type   = "metric"
          x      = 0
          y      = 18
          width  = 12
          height = 6
          properties = {
            metrics = [
              for k, tg in var.target_group_arn_suffixes :
              ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", tg, { label = k }]
            ]
            view    = "timeSeries"
            stacked = true
            region  = local.dash_region
            title   = "ALB HTTPCode_Target_4XX_Count by Target Group"
            period  = 300
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 18
          width  = 12
          height = 6
          properties = {
            metrics = [
              for k, tg in var.target_group_arn_suffixes :
              ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", tg, { label = k }]
            ]
            view    = "timeSeries"
            stacked = true
            region  = local.dash_region
            title   = "ALB HTTPCode_Target_5XX_Count by Target Group"
            period  = 300
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        }
      ],

      # ── Row 4: CloudFront Requests per distribution (six domains) ──────
      [
        {
          type   = "metric"
          x      = 0
          y      = 24
          width  = 24
          height = 6
          properties = {
            metrics = [
              for domain, id in var.cloudfront_distribution_ids :
              ["AWS/CloudFront", "Requests", "Region", "Global", "DistributionId", id, { label = domain }]
            ]
            view    = "timeSeries"
            stacked = false
            region  = local.dash_region
            title   = "CloudFront Requests by Distribution"
            period  = 300
            stat    = "Sum"
            yAxis   = { left = { min = 0 } }
          }
        }
      ],

      # ── Row 5: CloudFront 4xx / 5xx error rate per distribution ────────
      [
        {
          type   = "metric"
          x      = 0
          y      = 30
          width  = 12
          height = 6
          properties = {
            metrics = [
              for domain, id in var.cloudfront_distribution_ids :
              ["AWS/CloudFront", "4xxErrorRate", "Region", "Global", "DistributionId", id, { label = domain }]
            ]
            view    = "timeSeries"
            stacked = false
            region  = local.dash_region
            title   = "CloudFront 4xxErrorRate by Distribution"
            period  = 300
            stat    = "Average"
            yAxis   = { left = { min = 0 } }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 30
          width  = 12
          height = 6
          properties = {
            metrics = [
              for domain, id in var.cloudfront_distribution_ids :
              ["AWS/CloudFront", "5xxErrorRate", "Region", "Global", "DistributionId", id, { label = domain }]
            ]
            view    = "timeSeries"
            stacked = false
            region  = local.dash_region
            title   = "CloudFront 5xxErrorRate by Distribution"
            period  = 300
            stat    = "Average"
            yAxis   = { left = { min = 0 } }
          }
        }
      ],

      # ── Row 6: Strava rate-limit gauge (AR-08c) ────────────────────────
      [
        {
          type   = "metric"
          x      = 0
          y      = 36
          width  = 24
          height = 6
          properties = {
            metrics = [
              [var.metric_namespace, "StravaRateLimitUsage", { label = "Strava API usage (15-min window)" }]
            ]
            view    = "timeSeries"
            stacked = false
            region  = local.dash_region
            title   = "Strava Rate-Limit Usage"
            period  = 300
            stat    = "Maximum"
            yAxis   = { left = { min = 0 } }
          }
        }
      ]
    )
  })
}
