# IAM user for accessing each DynamoDB table
resource "aws_iam_user" "dynamodb_user" {
  for_each = local.table_configs

  name = "dynamodb-${each.key}-${var.site.label}-${var.region.label}-${local.table_suffix}"

  tags = {
    Name        = "DynamoDB User - ${each.key} - ${var.region.label}"
    Description = "IAM user for accessing DynamoDB table ${each.value.table_name}"
    Site        = var.site.label
    Region      = var.region.label
    TableName   = each.key
  }
}

# Access key for each IAM user
resource "aws_iam_access_key" "dynamodb_user" {
  for_each = aws_iam_user.dynamodb_user

  user = each.value.name
}

# IAM policy for DynamoDB access for each table
resource "aws_iam_policy" "dynamodb_access" {
  for_each = local.table_configs

  name        = "dynamodb-access-${each.key}-${var.site.label}-${var.region.label}-${local.table_suffix}"
  description = "Policy for accessing DynamoDB table ${each.value.table_name}"

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
          local.tables_output[each.key].table_arn,
          "${local.tables_output[each.key].table_arn}/index/*",
          "${local.tables_output[each.key].table_arn}/stream/*"
        ]
      }
    ]
  })
}

# Attach policy to each user
resource "aws_iam_user_policy_attachment" "dynamodb_user" {
  for_each = aws_iam_user.dynamodb_user

  user       = each.value.name
  policy_arn = aws_iam_policy.dynamodb_access[each.key].arn
}
