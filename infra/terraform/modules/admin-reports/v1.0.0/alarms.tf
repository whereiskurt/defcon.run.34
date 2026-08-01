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

# (a) Signups >= threshold per hour — spike detection (bulk-registration / recon).
resource "aws_cloudwatch_metric_alarm" "signups" {
  alarm_name          = "dcr-admin-signups-tripwire"
  alarm_description   = "DefconRun/Activity Signups >= ${var.threshold_signups_per_hour} in 1h (spike: bulk-registration / recon flood)."
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

# (e) Guardrail-sidecar outage (72-04). The ghosts run FAIL-CLOSED, so an
# unreachable sidecar is not a silent degradation — it is guarded chat refusing.
# This alarm is what makes that visible instead of mysterious.
#
# count-gated on the same condition as its metric filter: no log-group name means
# no filter, and an alarm on a metric nothing publishes would sit in
# INSUFFICIENT_DATA forever — the exact silent failure this exists to prevent.
resource "aws_cloudwatch_metric_alarm" "guardrail_outages" {
  count               = var.guardrail_log_group_name == "" ? 0 : 1
  alarm_name          = "dcr-mqtt-guardrail-outage"
  alarm_description   = "The run-mqtt guardrail sidecar is unreachable (>= ${var.threshold_guardrail_outages_per_5min} outages in 5min). The ghosts run fail-closed, so guarded chat is REFUSING — players get an in-persona degradation line instead of a ghost reply. Check the run-mqtt-guardrails container."
  namespace           = var.metric_namespace
  metric_name         = "GuardrailOutages"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.threshold_guardrail_outages_per_5min
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.tripwire.arn]
  # ok_actions here, unlike the spike alarms above: "the sidecar came back and the
  # ghosts are answering again" is genuinely useful news, not noise.
  ok_actions = [aws_sns_topic.tripwire.arn]
  tags       = var.tags
}

# (f) Per-sender LLM rate-limit refusals (73-02). meshtk refuses a radio that has
# emptied its per-(fleet, sender) token bucket, before any Bedrock call. Sustained
# refusals mean one or more radios are hammering a ghost — this alarm is the only
# way an operator finds that out without tailing logs.
#
# ⚠️ NOTIFY-ONLY, and that is a LOCKED decision (Kurt, 2026-08-01). alarm_actions
# is the SNS tripwire and nothing else: no Lambda, no autoscaling action, no SSM
# document, nothing that could disable model calls or take the fleet off the air.
# Dead ghosts mid-con are a worse failure than a visible overage.
#
# NO ok_actions, deliberately unlike the guardrail alarm above. "The sidecar came
# back" is news; "an abusive radio got bored" is not, and OK/ALARM flapping on a
# bursty counter is pure email noise.
#
# Same count gate as its metric filter: no log-group name means no filter, and an
# alarm on a metric nothing publishes sits in INSUFFICIENT_DATA forever.
resource "aws_cloudwatch_metric_alarm" "llm_rate_limits" {
  count               = var.guardrail_log_group_name == "" ? 0 : 1
  alarm_name          = "dcr-mqtt-llm-rate-limit"
  alarm_description   = "One or more mesh radios hit the per-sender LLM ceiling and were REFUSED (>= ${var.threshold_llm_rate_limits_per_5min} refusals in 5min). This is the limiter working: the offending radio got an in-persona refusal with no model call, and every other radio kept being served normally. NOTIFY-ONLY — this alarm never disables, throttles or silences the ghosts. Operator levers: the MESHTK_LLM_CALLS_PER_HOUR env knob on the ghosts container (raise it, or set it to exactly 0 as an emergency kill switch that refuses all model calls while the ghosts keep answering in words). NOTE: this counts refusals, not spend — aggregate cost across many distinct radios is deliberately unbounded (accepted 2026-08-01), so a quiet alarm is NOT proof that spend is controlled."
  namespace           = var.metric_namespace
  metric_name         = "LLMRateLimits"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.threshold_llm_rate_limits_per_5min
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.tripwire.arn]
  tags                = var.tags
}
