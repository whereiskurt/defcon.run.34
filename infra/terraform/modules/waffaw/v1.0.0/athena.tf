# Glue database, table, Athena workgroup, and 5 named queries

resource "aws_glue_catalog_database" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw"
}

resource "aws_glue_catalog_table" "waffaw_logs" {
  count = var.waffaw.enabled ? 1 : 0

  database_name = aws_glue_catalog_database.waffaw[0].name
  name          = "waffaw_logs"

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"  = "json"
    "compressionType" = "gzip"
    EXTERNAL          = "TRUE"
  }

  partition_keys {
    name = "campaign"
    type = "string"
  }

  partition_keys {
    name = "date"
    type = "string"
  }

  partition_keys {
    name = "hour"
    type = "string"
  }

  partition_keys {
    name = "region"
    type = "string"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs[0].bucket}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "serialization.format" = "1"
      }
    }

    columns {
      name = "timestamp"
      type = "string"
    }

    columns {
      name = "source_ip"
      type = "string"
    }

    columns {
      name = "node_rank"
      type = "int"
    }

    columns {
      name = "node_total"
      type = "int"
    }

    columns {
      name = "target_url"
      type = "string"
    }

    columns {
      name = "method"
      type = "string"
    }

    columns {
      name = "status_code"
      type = "int"
    }

    columns {
      name = "response_time_ms"
      type = "int"
    }

    columns {
      name = "scenario"
      type = "string"
    }

    columns {
      name = "engine"
      type = "string"
    }

    columns {
      name = "node_id"
      type = "string"
    }

    columns {
      name = "node_type"
      type = "string"
    }

    columns {
      name = "request_headers"
      type = "string"
    }

    columns {
      name = "response_headers"
      type = "string"
    }

    columns {
      name = "response_body_preview"
      type = "string"
    }

    columns {
      name = "page_title"
      type = "string"
    }

    columns {
      name = "console_errors"
      type = "array<string>"
    }
  }
}

# Athena workgroup
resource "aws_athena_workgroup" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw"

  configuration {
    enforce_workgroup_configuration = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.logs[0].bucket}/athena-results/"
    }

    engine_version {
      selected_engine_version = "Athena engine version 3"
    }
  }

  tags = {
    Name   = "waffaw-workgroup"
    Region = var.region.label
    Site   = var.site.label
  }
}

# ─── Named Queries ───

resource "aws_athena_named_query" "campaign_summary" {
  count = var.waffaw.enabled ? 1 : 0

  name        = "waffaw-campaign-summary"
  description = "Single-row campaign summary: volume, IP diversity, duration, block rate"
  workgroup   = aws_athena_workgroup.waffaw[0].name
  database    = aws_glue_catalog_database.waffaw[0].name

  query = <<-SQL
    SELECT
      campaign,
      COUNT(*) AS total_requests,
      COUNT(DISTINCT source_ip) AS unique_ips,
      MIN(timestamp) AS started,
      MAX(timestamp) AS ended,
      date_diff('minute', MIN(from_iso8601_timestamp(timestamp)), MAX(from_iso8601_timestamp(timestamp))) AS duration_minutes,
      AVG(response_time_ms) AS avg_response_ms,
      COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked,
      ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct
    FROM waffaw_logs
    WHERE campaign = '{campaign}'
    GROUP BY campaign
  SQL
}

resource "aws_athena_named_query" "time_to_detection" {
  count = var.waffaw.enabled ? 1 : 0

  name        = "waffaw-time-to-detection"
  description = "Per-IP time from first request to first block"
  workgroup   = aws_athena_workgroup.waffaw[0].name
  database    = aws_glue_catalog_database.waffaw[0].name

  query = <<-SQL
    SELECT
      source_ip,
      node_type,
      MIN(timestamp) AS first_request,
      MIN(CASE WHEN status_code = 403 THEN timestamp END) AS first_block,
      date_diff('minute',
        MIN(from_iso8601_timestamp(timestamp)),
        MIN(CASE WHEN status_code = 403 THEN from_iso8601_timestamp(timestamp) END)
      ) AS minutes_to_detect,
      COUNT(*) AS total_requests,
      COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked_requests
    FROM waffaw_logs
    WHERE campaign = '{campaign}'
    GROUP BY source_ip, node_type
    ORDER BY minutes_to_detect ASC NULLS LAST
  SQL
}

resource "aws_athena_named_query" "block_rate_by_scenario" {
  count = var.waffaw.enabled ? 1 : 0

  name        = "waffaw-block-rate-by-scenario"
  description = "Block rate per attack scenario"
  workgroup   = aws_athena_workgroup.waffaw[0].name
  database    = aws_glue_catalog_database.waffaw[0].name

  query = <<-SQL
    SELECT
      scenario,
      COUNT(*) AS total,
      COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked,
      ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct
    FROM waffaw_logs
    WHERE campaign = '{campaign}'
    GROUP BY scenario
    ORDER BY block_rate_pct DESC
  SQL
}

resource "aws_athena_named_query" "hourly_volume" {
  count = var.waffaw.enabled ? 1 : 0

  name        = "waffaw-hourly-volume"
  description = "Hourly request volume and block rate"
  workgroup   = aws_athena_workgroup.waffaw[0].name
  database    = aws_glue_catalog_database.waffaw[0].name

  query = <<-SQL
    SELECT
      date_format(from_iso8601_timestamp(timestamp), '%Y-%m-%d %H:00') AS hour,
      COUNT(*) AS requests,
      COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked,
      ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct
    FROM waffaw_logs
    WHERE campaign = '{campaign}'
    GROUP BY date_format(from_iso8601_timestamp(timestamp), '%Y-%m-%d %H:00')
    ORDER BY hour
  SQL
}

resource "aws_athena_named_query" "cross_ip_correlation" {
  count = var.waffaw.enabled ? 1 : 0

  name        = "waffaw-cross-ip-correlation"
  description = "Compare block rates between EC2 (stable IPs) and Fargate (rotating IPs)"
  workgroup   = aws_athena_workgroup.waffaw[0].name
  database    = aws_glue_catalog_database.waffaw[0].name

  query = <<-SQL
    SELECT
      node_type,
      COUNT(DISTINCT source_ip) AS unique_ips,
      COUNT(*) AS total_requests,
      COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked,
      ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct
    FROM waffaw_logs
    WHERE campaign = '{campaign}'
    GROUP BY node_type
  SQL
}
