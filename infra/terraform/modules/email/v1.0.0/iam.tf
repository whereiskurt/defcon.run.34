resource "aws_iam_user" "ses_user" {
  name = substr("${var.email.smtp_prefix}.${var.region.label}", 0, 63)
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
  user = aws_iam_user.ses_user.name
}

# SMTP credential users for individual email addresses
resource "aws_iam_user" "smtp_credential_users" {
  for_each = toset(var.smtp_iam_users)
  name     = substr("ses-smtp-${var.region.label}-${replace(each.value, "@", "-at-")}", 0, 63)
  tags = {
    Email = each.value
  }
}

resource "aws_iam_user_policy" "smtp_credential_policy" {
  for_each = toset(var.smtp_iam_users)
  name     = "ses_smtp_policy"
  user     = aws_iam_user.smtp_credential_users[each.key].name
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

resource "aws_iam_access_key" "smtp_credential_keys" {
  for_each = toset(var.smtp_iam_users)
  user     = aws_iam_user.smtp_credential_users[each.key].name
}
