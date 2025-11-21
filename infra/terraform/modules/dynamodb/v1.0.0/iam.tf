# IAM user for accessing the DynamoDB table
resource "aws_iam_user" "dynamodb_user" {
  name = "dynamodb-${var.site.label}-${var.region.label}-${local.table_suffix}"

  tags = {
    Name        = "DynamoDB User - ${var.region.label}"
    Description = "IAM user for accessing DynamoDB table ${local.table_name}"
    Site        = var.site.label
    Region      = var.region.label
  }
}

# Access key for the IAM user
resource "aws_iam_access_key" "dynamodb_user" {
  user = aws_iam_user.dynamodb_user.name
}

# IAM policy for DynamoDB access
resource "aws_iam_policy" "dynamodb_access" {
  name        = "dynamodb-access-${var.site.label}-${var.region.label}-${local.table_suffix}"
  description = "Policy for accessing DynamoDB table ${local.table_name}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBTableAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem",
          "dynamodb:DescribeStream",
          "dynamodb:ListStreams"
        ]
        Resource = [
          local.table_arn,
          "${local.table_arn}/index/*",
          "${local.table_arn}/stream/*"
        ]
      }
    ]
  })
}

# Attach policy to user
resource "aws_iam_user_policy_attachment" "dynamodb_user" {
  user       = aws_iam_user.dynamodb_user.name
  policy_arn = aws_iam_policy.dynamodb_access.arn
}
