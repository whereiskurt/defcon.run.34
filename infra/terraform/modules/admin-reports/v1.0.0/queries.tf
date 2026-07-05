# =============================================================================
# Saved Logs Insights query definitions, folder-prefixed `admin/` (AR-06)
#
# Each query targets the three app /ecs/* groups (the DefconRun/Activity event
# stream) and parses the structured JSON event fields (evt / userId / ip). The
# two "dig in" queries carry an editable placeholder filter the operator swaps at
# run time. error-spikes counts non-event error volume per service (@log).
# =============================================================================

locals {
  admin_query_log_groups = values(var.log_group_names)
}

# --- Dig in: who is this user? ------------------------------------------------
resource "aws_cloudwatch_query_definition" "user_activity" {
  name            = "admin/user-activity"
  log_group_names = local.admin_query_log_groups

  query_string = <<-EOQ
    fields @timestamp, evt, userId, email, ip, ua, meta
    | filter userId = "PUT-USER-ID-HERE" or email = "PUT-EMAIL-HERE"
    | sort @timestamp desc
    | limit 200
  EOQ
}

# --- Dig in: what has this IP done? -------------------------------------------
resource "aws_cloudwatch_query_definition" "ip_activity" {
  name            = "admin/ip-activity"
  log_group_names = local.admin_query_log_groups

  query_string = <<-EOQ
    fields @timestamp, evt, userId, email, ip, ua
    | filter ip = "PUT-IP-HERE"
    | sort @timestamp desc
    | limit 200
  EOQ
}

# --- Glance: busiest IPs in the last hour -------------------------------------
resource "aws_cloudwatch_query_definition" "top_ips_1h" {
  name            = "admin/top-ips-1h"
  log_group_names = local.admin_query_log_groups

  query_string = <<-EOQ
    fields ip
    | filter ispresent(evt) and ispresent(ip)
    | stats count(*) as events by ip
    | sort events desc
    | limit 50
  EOQ
}

# --- Glance: who is uploading the most ----------------------------------------
resource "aws_cloudwatch_query_definition" "top_uploaders" {
  name            = "admin/top-uploaders"
  log_group_names = local.admin_query_log_groups

  query_string = <<-EOQ
    fields userId
    | filter evt = "gpx.file.create" or evt = "human.upload"
    | stats count(*) as uploads by userId
    | sort uploads desc
    | limit 50
  EOQ
}

# --- Trend: signups over time -------------------------------------------------
resource "aws_cloudwatch_query_definition" "signups_over_time" {
  name            = "admin/signups-over-time"
  log_group_names = local.admin_query_log_groups

  query_string = <<-EOQ
    fields @timestamp
    | filter evt = "auth.signup"
    | stats count(*) as signups by bin(1h) as hour
    | sort hour asc
  EOQ
}

# --- Trend: distinct active users per day -------------------------------------
resource "aws_cloudwatch_query_definition" "distinct_users_by_day" {
  name            = "admin/distinct-users-by-day"
  log_group_names = local.admin_query_log_groups

  query_string = <<-EOQ
    fields userId
    | filter ispresent(evt) and ispresent(userId)
    | stats count_distinct(userId) as distinct_users by bin(1d) as day
    | sort day asc
  EOQ
}

# --- Alert: non-event error spikes per service --------------------------------
resource "aws_cloudwatch_query_definition" "error_spikes" {
  name            = "admin/error-spikes"
  log_group_names = local.admin_query_log_groups

  query_string = <<-EOQ
    fields @timestamp, @message, @log
    | filter @message like /(?i)error/ and not ispresent(evt)
    | stats count(*) as errors by bin(5m) as window, @log
    | sort errors desc
    | limit 100
  EOQ
}
