# IAM Role for on-upload Lambda
resource "aws_iam_role" "on_upload_lambda" {
  for_each = local.processors_map

  name = substr("lambda-on-upload-${var.site.label}-${each.key}-${var.region.label}", 0, 64)

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name    = "lambda-on-upload-${each.key}"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# IAM Policy for on-upload Lambda
resource "aws_iam_role_policy" "on_upload_lambda" {
  for_each = local.processors_map

  name = "on-upload-policy"
  role = aws_iam_role.on_upload_lambda[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudWatch Logs
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/*"
      },
      # S3 - read uploaded objects (for head/metadata)
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:HeadObject",
          "s3:GetObjectTagging"
        ]
        Resource = "${each.value.bucket_arn}/uploads/*"
      },
      # DynamoDB - update upload records
      {
        Effect = "Allow"
        Action = [
          "dynamodb:UpdateItem",
          "dynamodb:GetItem"
        ]
        Resource = each.value.dynamodb_table_arn
      }
    ]
  })
}

# IAM Role for processor Lambda
resource "aws_iam_role" "processor_lambda" {
  for_each = local.processors_map

  name = substr("lambda-processor-${var.site.label}-${each.key}-${var.region.label}", 0, 64)

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name    = "lambda-processor-${each.key}"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# IAM Policy for processor Lambda
resource "aws_iam_role_policy" "processor_lambda" {
  for_each = local.processors_map

  name = "processor-policy"
  role = aws_iam_role.processor_lambda[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      # CloudWatch Logs
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/*"
      },
    ],
    # DynamoDB Streams - read stream events (only when stream ARN is known)
    each.value.dynamodb_stream_arn != "" ? [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:DescribeStream",
        "dynamodb:ListStreams"
      ]
      Resource = each.value.dynamodb_stream_arn
    }] : [],
    [
      # DynamoDB - update upload records
      {
        Effect = "Allow"
        Action = [
          "dynamodb:UpdateItem",
          "dynamodb:GetItem"
        ]
        Resource = each.value.dynamodb_table_arn
      },
      # S3 - read from uploads/, write to processed/
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:HeadObject",
          "s3:GetObjectTagging"
        ]
        Resource = "${each.value.bucket_arn}/uploads/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectTagging"
        ]
        Resource = "${each.value.bucket_arn}/processed/*"
      }
    ])
  })
}
