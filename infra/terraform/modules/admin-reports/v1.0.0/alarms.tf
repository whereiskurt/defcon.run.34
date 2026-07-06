# =============================================================================
# SNS tripwire topic + four parameterized alarms (AR-07)
#
# One SNS topic + email subscription, and four alarms — all alarm_actions point
# at the topic. Every threshold and the email come from variables (surfaced in
# site.hcl) so con-week is a one-line bump.
#
# The two ALB alarms bind their `LoadBalancer` dimension to var.alb_arn_suffix
# (the same input the dashboard uses). An alarm with an unresolved/omitted
# dimension silently sits in INSUFFICIENT_DATA forever, so the terragrunt unit
# must populate alb_arn_suffix from the network unit.
# =============================================================================

resource "aws_sns_topic" "tripwire" {
  name = "dcr-admin-reports-tripwire"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "tripwire_email" {
  topic_arn = aws_sns_topic.tripwire.arn
  protocol  = "email"
  endpoint  = var.sns_alarm_email
}

# (a) Signups >= threshold per hour — pre-con: any signup is news.
resource "aws_cloudwatch_metric_alarm" "signups" {
  alarm_name          = "dcr-admin-signups-tripwire"
  alarm_description   = "DefconRun/Activity Signups >= ${var.threshold_signups_per_hour} in 1h (pre-con: any signup is news)."
  namespace           = var.metric_namespace
  metric_name         = "Signups"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.threshold_signups_per_hour
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.tripwire.arn]
  # No ok_actions: a signup firing is news; the follow-up "returned to OK" email
  # (count fell back to 0 after the hour) is just noise.
  tags = var.tags
}

# (b) GpxUploads >= threshold per hour.
resource "aws_cloudwatch_metric_alarm" "gpx_uploads" {
  alarm_name          = "dcr-admin-gpx-uploads-tripwire"
  alarm_description   = "DefconRun/Activity GpxUploads >= ${var.threshold_gpx_uploads_per_hour} in 1h."
  namespace           = var.metric_namespace
  metric_name         = "GpxUploads"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.threshold_gpx_uploads_per_hour
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.tripwire.arn]
  tags                = var.tags
}

# (c) ALB total RequestCount anomaly-detection alarm. The band self-trains; the
# alarm fires when observed RequestCount breaches the upper edge of the expected
# band. LoadBalancer dimension bound to var.alb_arn_suffix.
resource "aws_cloudwatch_metric_alarm" "alb_request_anomaly" {
  count               = var.alb_anomaly_alarm_enabled ? 1 : 0
  alarm_name          = "dcr-admin-alb-requestcount-anomaly"
  alarm_description   = "ALB total RequestCount outside its anomaly-detection band (unusual traffic volume)."
  comparison_operator = "GreaterThanUpperThreshold"
  evaluation_periods  = 1
  threshold_metric_id = "ad1"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.tripwire.arn]
  tags                = var.tags

  metric_query {
    id          = "m1"
    return_data = true
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 300
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
      }
    }
  }

  metric_query {
    id          = "ad1"
    expression  = "ANOMALY_DETECTION_BAND(m1, 2)"
    label       = "RequestCount (expected band)"
    return_data = true
  }
}

# (d) ALB HTTPCode_Target_5XX_Count >= threshold per 5 min. LoadBalancer
# dimension bound to var.alb_arn_suffix (aggregate across target groups).
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "dcr-admin-alb-5xx-tripwire"
  alarm_description   = "ALB HTTPCode_Target_5XX_Count >= ${var.threshold_alb_5xx_per_5min} in 5min."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.threshold_alb_5xx_per_5min
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.tripwire.arn]
  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }
  tags = var.tags
}
