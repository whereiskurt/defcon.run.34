# CloudWatch log group, subscription filter, and Firehose delivery stream

resource "aws_cloudwatch_log_group" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  name              = "/waffaw/${var.region.full}"
  retention_in_days = 7

  tags = {
    Name   = "waffaw-logs-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

# Subscription filter: forward all log events to Firehose
resource "aws_cloudwatch_log_subscription_filter" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  name            = "waffaw-to-firehose"
  log_group_name  = aws_cloudwatch_log_group.waffaw[0].name
  filter_pattern  = ""
  destination_arn = aws_kinesis_firehose_delivery_stream.waffaw[0].arn
  role_arn        = aws_iam_role.cw_to_firehose[0].arn
}

# Kinesis Firehose delivery stream with dynamic partitioning
resource "aws_kinesis_firehose_delivery_stream" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  name        = "waffaw-logs-${var.region.label}"
  destination = "extended_s3"

  extended_s3_configuration {
    role_arn   = aws_iam_role.firehose[0].arn
    bucket_arn = aws_s3_bucket.logs[0].arn

    # Dynamic partitioning by campaign field from JSON log records
    prefix              = "campaign=!{partitionKeyFromQuery:campaign}/date=!{timestamp:yyyy-MM-dd}/hour=!{timestamp:HH}/region=${var.region.full}/"
    error_output_prefix = "errors/!{firehose:error-output-type}/date=!{timestamp:yyyy-MM-dd}/"

    buffering_size     = 64
    buffering_interval = 60
    compression_format = "GZIP"

    dynamic_partitioning_configuration {
      enabled = true
    }

    processing_configuration {
      enabled = true

      processors {
        type = "MetadataExtraction"
        parameters {
          parameter_name  = "MetadataExtractionQuery"
          parameter_value = "{campaign: .campaign}"
        }
        parameters {
          parameter_name  = "JsonParsingEngine"
          parameter_value = "JQ-1.6"
        }
      }

      # Decompress CloudWatch Logs subscription filter data
      processors {
        type = "Decompression"
        parameters {
          parameter_name  = "CompressionFormat"
          parameter_value = "GZIP"
        }
      }

      processors {
        type = "CloudWatchLogProcessing"
        parameters {
          parameter_name  = "DataMessageExtraction"
          parameter_value = "true"
        }
      }
    }
  }

  tags = {
    Name   = "waffaw-firehose-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}
