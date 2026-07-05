# =============================================================================
# abuse-detection — Athena/Glue substrate (AD-01, AD-02)
#
# - Glue external table `alb_access_logs` over the REAL ALB access-log S3 prefix
#   (var.alb_logs_bucket_name — wired from the network unit in Plan 05, never
#   guessed) using the AWS-documented ALB-log RegexSerDe + date partition
#   projection (no crawler, no MSCK REPAIR).
# - Athena workgroup `dcr-abuse-analysis` with a per-query bytes-scanned cap.
# - One dual-role results bucket: Athena query output under query-results/;
#   Plans 03/04 write findings/state/digest under abuse/.
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  results_bucket_name = "${var.site.label}-abuse-detection-${var.site.random_suffix}"

  # Base S3 prefix for ALB access logs. Shape (network/alb.tf):
  #   s3://<alb-log-bucket>/access/AWSLogs/<account>/elasticloadbalancing/<region>/YYYY/MM/DD/...
  # The bucket name is a VARIABLE (Plan 05 wiring) — never a guessed literal.
  alb_log_base = "s3://${var.alb_logs_bucket_name}/${var.alb_logs_prefix}/AWSLogs/${data.aws_caller_identity.current.account_id}/elasticloadbalancing/${data.aws_region.current.id}"
}

# -----------------------------------------------------------------------------
# Dual-role results / findings bucket
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "results" {
  bucket        = local.results_bucket_name
  force_destroy = true

  tags = merge(var.tags, {
    Name      = local.results_bucket_name
    Site      = var.site.label
    Purpose   = "abuse-detection-results"
    ManagedBy = "Terragrunt"
  })
}

resource "aws_s3_bucket_public_access_block" "results" {
  bucket = aws_s3_bucket.results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "results" {
  bucket = aws_s3_bucket.results.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "results" {
  bucket = aws_s3_bucket.results.id

  # Expire Athena query results after 7 days. Findings under abuse/ are retained.
  rule {
    id     = "expire-query-results"
    status = "Enabled"

    filter {
      prefix = "query-results/"
    }

    expiration {
      days = 7
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# -----------------------------------------------------------------------------
# Athena workgroup (AD-02) — bytes-scanned cap is the runaway-scan guardrail
# -----------------------------------------------------------------------------

resource "aws_athena_workgroup" "abuse" {
  name = "dcr-abuse-analysis"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    bytes_scanned_cutoff_per_query     = var.athena_bytes_scanned_cutoff

    result_configuration {
      output_location = "s3://${aws_s3_bucket.results.id}/query-results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }

  tags = merge(var.tags, {
    Name      = "dcr-abuse-analysis"
    Site      = var.site.label
    Purpose   = "abuse-detection-queries"
    ManagedBy = "Terragrunt"
  })
}

# -----------------------------------------------------------------------------
# Glue catalog: database + ALB access-log external table (AD-01)
# -----------------------------------------------------------------------------

resource "aws_glue_catalog_database" "abuse" {
  name        = "${replace(var.site.label, "-", "_")}_abuse"
  description = "ALB access-log analysis database for ${var.site.label} abuse detection."
}

resource "aws_glue_catalog_table" "alb_access_logs" {
  name          = "alb_access_logs"
  database_name = aws_glue_catalog_database.abuse.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL = "TRUE"

    # Date partition projection — no crawler, no MSCK REPAIR (crib: cloudtrail).
    "projection.enabled"           = "true"
    "projection.day.type"          = "date"
    "projection.day.format"        = "yyyy/MM/dd"
    "projection.day.range"         = "${var.projection_start_date},NOW"
    "projection.day.interval"      = "1"
    "projection.day.interval.unit" = "DAYS"
    "storage.location.template"    = "${local.alb_log_base}/$${day}"
  }

  storage_descriptor {
    location      = "${local.alb_log_base}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.serde2.RegexSerDe"

      parameters = {
        "serialization.format" = "1"

        # Canonical AWS "Querying Application Load Balancer logs" regex.
        # client_ip:client_port and the request field are split into their own
        # capture groups so Plan 02 queries key on client_ip / request_verb /
        # request_url directly. 33 groups == 33 columns below.
        "input.regex" = trimspace(<<-REGEX
          ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*):([0-9]*) ([^ ]*)[:-]([0-9]*) ([-.0-9]*) ([-.0-9]*) ([-.0-9]*) (|[-0-9]*) (-|[-0-9]*) ([-0-9]*) ([-0-9]*) "([^ ]*) (.*) (- |[^ ]*)" "([^"]*)" ([A-Z0-9-_]+) ([A-Za-z0-9.-]*) ([^ ]*) "([^"]*)" "([^"]*)" "([^"]*)" ([-.0-9]*) ([^ ]*) "([^"]*)" "([^"]*)" "([^ ]*)" "([^\s]+?)" "([^\s]+)" "([^ ]*)" "([^ ]*)"
        REGEX
        )
      }
    }

    # --- Canonical ALB access-log columns (order MUST match the regex groups) --
    columns {
      name = "type"
      type = "string"
    }
    columns {
      name = "time"
      type = "string"
    }
    columns {
      name = "elb"
      type = "string"
    }
    columns {
      name = "client_ip"
      type = "string"
    }
    columns {
      name = "client_port"
      type = "int"
    }
    columns {
      name = "target_ip"
      type = "string"
    }
    columns {
      name = "target_port"
      type = "int"
    }
    columns {
      name = "request_processing_time"
      type = "double"
    }
    columns {
      name = "target_processing_time"
      type = "double"
    }
    columns {
      name = "response_processing_time"
      type = "double"
    }
    columns {
      name = "elb_status_code"
      type = "int"
    }
    columns {
      name = "target_status_code"
      type = "string"
    }
    columns {
      name = "received_bytes"
      type = "bigint"
    }
    columns {
      name = "sent_bytes"
      type = "bigint"
    }
    columns {
      name = "request_verb"
      type = "string"
    }
    columns {
      name = "request_url"
      type = "string"
    }
    columns {
      name = "request_proto"
      type = "string"
    }
    columns {
      name = "user_agent"
      type = "string"
    }
    columns {
      name = "ssl_cipher"
      type = "string"
    }
    columns {
      name = "ssl_protocol"
      type = "string"
    }
    columns {
      name = "target_group_arn"
      type = "string"
    }
    columns {
      name = "trace_id"
      type = "string"
    }
    columns {
      name = "domain_name"
      type = "string"
    }
    columns {
      name = "chosen_cert_arn"
      type = "string"
    }
    columns {
      name = "matched_rule_priority"
      type = "string"
    }
    columns {
      name = "request_creation_time"
      type = "string"
    }
    columns {
      name = "actions_executed"
      type = "string"
    }
    columns {
      name = "redirect_url"
      type = "string"
    }
    columns {
      name = "lambda_error_reason"
      type = "string"
    }
    columns {
      name = "target_port_list"
      type = "string"
    }
    columns {
      name = "target_status_code_list"
      type = "string"
    }
    columns {
      name = "classification"
      type = "string"
    }
    columns {
      name = "classification_reason"
      type = "string"
    }
  }

  partition_keys {
    name = "day"
    type = "string"
  }
}
