# =============================================================================
# Metric filters: app event stream -> DefconRun/Activity metrics (AR-04)
# One filter per event family. Patterns key on the structured `$.evt` field of
# the single-line JSON events emitted by logEvent() in run.auth / run.gpx /
# run.human (LOCKED contract from 40-01/40-02/40-03). A spoofed free-text field
# cannot forge a counted event (threat T-40-10) because only `$.evt` drives the
# match.
#
# Count metrics publish value 1 with default_value 0 so alarms (40-06) treat "no
# activity" as a real 0. The Strava filter is a gauge: it publishes the numeric
# `$.meta.usage` quota reading (LOCKED with 40-02) — NOT a literal 1.
# =============================================================================

# --- run.auth -----------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "signups" {
  name           = "dcr-admin-signups"
  log_group_name = var.log_group_names["auth"]
  pattern        = "{ $.evt = \"auth.signup\" }"

  metric_transformation {
    name          = "Signups"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "logins" {
  name           = "dcr-admin-logins"
  log_group_name = var.log_group_names["auth"]
  pattern        = "{ $.evt = \"auth.login\" }"

  metric_transformation {
    name          = "Logins"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# --- run.gpx ------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "gpx_uploads" {
  name           = "dcr-admin-gpx-uploads"
  log_group_name = var.log_group_names["gpx"]
  pattern        = "{ $.evt = \"gpx.file.create\" }"

  metric_transformation {
    name          = "GpxUploads"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "gpx_shares" {
  name           = "dcr-admin-gpx-shares"
  log_group_name = var.log_group_names["gpx"]
  pattern        = "{ $.evt = \"gpx.file.publish\" || $.evt = \"gpx.share.request\" || $.evt = \"gpx.share.accept\" }"

  metric_transformation {
    name          = "GpxShares"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "map_views" {
  name           = "dcr-admin-map-views"
  log_group_name = var.log_group_names["gpx"]
  pattern        = "{ $.evt = \"gpx.map.view\" }"

  metric_transformation {
    name          = "MapViews"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# Strava rate-limit gauge (AR-08c). value = $.meta.usage (LOCKED numeric field
# 40-02 emits) so StravaRateLimitUsage carries the real quota reading. Binding
# to `1` or any other path yields a silently always-empty Strava widget.
resource "aws_cloudwatch_log_metric_filter" "strava_ratelimit_usage" {
  name           = "dcr-admin-strava-ratelimit-usage"
  log_group_name = var.log_group_names["gpx"]
  pattern        = "{ $.evt = \"strava.ratelimit\" }"

  metric_transformation {
    name      = "StravaRateLimitUsage"
    namespace = var.metric_namespace
    value     = "$.meta.usage"
    unit      = "Count"
  }
}

# --- run.human ----------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "checkins" {
  name           = "dcr-admin-checkins"
  log_group_name = var.log_group_names["human"]
  pattern        = "{ $.evt = \"human.checkin\" }"

  metric_transformation {
    name          = "Checkins"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "uploads" {
  name           = "dcr-admin-uploads"
  log_group_name = var.log_group_names["human"]
  pattern        = "{ $.evt = \"human.upload\" }"

  metric_transformation {
    name          = "Uploads"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# --- run.mqtt ghosts (72-04) --------------------------------------------------

# Guardrail-sidecar outage counter. UNLIKE every filter above, this one is a
# PLAIN-TEXT pattern, not a `$.evt` JSON selector: meshtk's guard logs are
# unstructured logrus text, so a JSON selector would never match and the metric
# would read a convincing, permanent zero.
#
# The pattern keys on the stable marker token meshtk emits on every guard-outage
# branch (added in 72-07). Until that ships the metric reads a real 0, which is
# correct and harmless.
#
# count-gated so an unset log-group name provisions nothing rather than binding a
# filter to a nonexistent group. The group is NOT in var.log_group_names on
# purpose — see that variable's docs (retention.tf would adopt it).
resource "aws_cloudwatch_log_metric_filter" "guardrail_outages" {
  count          = var.guardrail_log_group_name == "" ? 0 : 1
  name           = "dcr-mqtt-guardrail-outages"
  log_group_name = var.guardrail_log_group_name
  pattern        = "MESHTK_GUARDRAIL_OUTAGE"

  metric_transformation {
    name          = "GuardrailOutages"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

# Per-sender LLM rate-limit refusal counter (73-02). meshtk holds a per-(fleet,
# sender) token bucket in front of the Bedrock call; when a radio empties its
# bucket the request is refused in words BEFORE any model call, and the refusal
# branch logs a stable marker token (73-01).
#
# Same lesson as the filter above, restated because it is the one that bites:
# this pattern is PLAIN TEXT, not a `$.evt` JSON selector. meshtk logs
# unstructured logrus lines, so a JSON selector matches nothing and the metric
# publishes a convincing, permanent zero — a monitoring gap that reads as
# perfect health. 72-04 learned that the hard way; do not "improve" this into a
# selector.
#
# ⚠️ What this counts is REFUSALS, not dollars. It goes up when the ceiling
# WORKS. It says nothing about aggregate Bedrock spend: many distinct radios
# each sitting just under their own bucket cost real money and raise nothing
# here. That gap is a recorded acceptance (Kurt, 2026-08-01 — an AWS Budgets /
# InvocationCount backstop was offered and declined), not an oversight. Never
# read a quiet LLMRateLimits metric as proof that spend is under control.
#
# A flat zero before 73-01 ships is real and correct — the token does not exist
# yet. Same count gate as above: no log-group name provisions nothing.
resource "aws_cloudwatch_log_metric_filter" "llm_rate_limits" {
  count          = var.guardrail_log_group_name == "" ? 0 : 1
  name           = "dcr-mqtt-llm-rate-limits"
  log_group_name = var.guardrail_log_group_name
  pattern        = "MESHTK_LLM_RATE_LIMIT"

  metric_transformation {
    name          = "LLMRateLimits"
    namespace     = var.metric_namespace
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}
