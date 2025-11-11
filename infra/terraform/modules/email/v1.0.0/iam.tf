resource "aws_iam_user" "ses_user" {
  name     = "${local.smtp_zonename}"
}

resource "aws_iam_user_policy" "ses_policy" {
  name = "ses_user_policy"
  user = aws_iam_user.ses_user.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_access_key" "ses_user_key" {
  user     = aws_iam_user.ses_user.name
}
