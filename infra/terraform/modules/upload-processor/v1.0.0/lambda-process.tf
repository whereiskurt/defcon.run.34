# Lambda function for processing uploads
# Triggered by DynamoDB Streams when status changes to "uploaded"

# Package the Lambda code
data "archive_file" "processor" {
  for_each = local.processors_map

  type        = "zip"
  source_dir  = "${path.module}/lambda/processor"
  output_path = "${path.module}/lambda/processor-${each.key}.zip"
}

# Lambda function
resource "aws_lambda_function" "processor" {
  for_each = local.processors_map

  function_name = "processor-${var.site.label}-${each.key}-${var.region.label}"
  role          = aws_iam_role.processor_lambda[each.key].arn
  handler       = "index.handler"
  runtime       = "python3.12"

  filename         = data.archive_file.processor[each.key].output_path
  source_code_hash = data.archive_file.processor[each.key].output_base64sha256

  timeout     = try(each.value.processor_lambda.timeout, 300)
  memory_size = try(each.value.processor_lambda.memory_size, 1024)

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = each.value.dynamodb_table_name
      S3_BUCKET_NAME      = each.value.bucket_id
    }
  }

  tags = {
    Name    = "processor-${each.key}"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# CloudWatch Log Group for processor Lambda
resource "aws_cloudwatch_log_group" "processor" {
  for_each = local.processors_map

  name              = "/aws/lambda/processor-${var.site.label}-${each.key}-${var.region.label}"
  retention_in_days = 14

  tags = {
    Name    = "processor-${each.key}-logs"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# DynamoDB Stream event source mapping
resource "aws_lambda_event_source_mapping" "processor" {
  for_each = local.processors_map

  event_source_arn  = each.value.dynamodb_stream_arn
  function_name     = aws_lambda_function.processor[each.key].arn
  starting_position = "LATEST"

  # Only process new records
  batch_size = 10

  # Filter for MODIFY events with status change
  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["MODIFY"]
        dynamodb = {
          NewImage = {
            status = {
              S = ["uploaded"]
            }
          }
        }
      })
    }
  }
}
