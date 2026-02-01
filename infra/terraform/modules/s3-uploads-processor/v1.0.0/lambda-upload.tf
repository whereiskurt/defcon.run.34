# Lambda function for on-upload processing
# Triggered by SNS when files are uploaded to S3

# Package the Lambda code from service-provided source path
data "archive_file" "on_upload" {
  for_each = local.processors_map

  type        = "zip"
  source_dir  = each.value.on_upload_lambda.source_path
  output_path = "${path.module}/.lambda-zips/on-upload-${each.key}.zip"
}

# Lambda function
resource "aws_lambda_function" "on_upload" {
  for_each = local.processors_map

  function_name                  = "on-upload-${var.site.label}-${each.key}-${var.region.label}"
  role                           = aws_iam_role.on_upload_lambda[each.key].arn
  handler                        = "index.handler"
  runtime                        = "python3.12"
  reserved_concurrent_executions = 10

  filename         = data.archive_file.on_upload[each.key].output_path
  source_code_hash = data.archive_file.on_upload[each.key].output_base64sha256

  timeout     = try(each.value.on_upload_lambda.timeout, 30)
  memory_size = try(each.value.on_upload_lambda.memory_size, 256)

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = each.value.dynamodb_table_name
      S3_BUCKET_NAME      = each.value.bucket_id
    }
  }

  tags = {
    Name    = "on-upload-${each.key}"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# CloudWatch Log Group for on-upload Lambda
resource "aws_cloudwatch_log_group" "on_upload" {
  for_each = local.processors_map

  name              = "/aws/lambda/on-upload-${var.site.label}-${each.key}-${var.region.label}"
  retention_in_days = 14

  tags = {
    Name    = "on-upload-${each.key}-logs"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# SNS subscription for Lambda
resource "aws_sns_topic_subscription" "on_upload" {
  for_each = local.processors_map

  topic_arn = aws_sns_topic.upload_notifications[each.key].arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.on_upload[each.key].arn
}

# Lambda permission for SNS to invoke
resource "aws_lambda_permission" "on_upload_sns" {
  for_each = local.processors_map

  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.on_upload[each.key].function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.upload_notifications[each.key].arn
}
