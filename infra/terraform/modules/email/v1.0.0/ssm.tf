resource "aws_ssm_parameter" "email_zonename" {
  name     = "/${local.ses}/zonename"
  type     = "String"
  value    = var.email.zonename
}

resource "aws_ssm_parameter" "aws_emailuri" {
  name     = "/${local.ses}/awsuri"
  type     = "String"
  value    = "https://email.${var.region.full}.amazonaws.com"
}

resource "aws_ssm_parameter" "smtp_url_with_v4" {
  name     = "/${local.ses}/smtp_url_v4"
  type     = "SecureString"
  ##The replace is necessary because an IAM access key ID cannot contain slashes
  ##Slashes aren't URL friendly. Other chars like + are handled fine by most URL parsers but the '/' is not.
  value    = "smtp://${aws_iam_access_key.ses_user_key.id}:${replace(aws_iam_access_key.ses_user_key.ses_smtp_password_v4, "/", "%2F")}@email-smtp.${var.region.full}.amazonaws.com:587"
}

resource "aws_ssm_parameter" "smtp_host" {
  name     = "/${local.ses}/smtp_host"
  type     = "String"
  value    = "email-smtp.${var.region.full}.amazonaws.com"
}

resource "aws_ssm_parameter" "ses_access_key" {
  name     = "/${local.ses}/access_key"
  type     = "String"
  value    = aws_iam_access_key.ses_user_key.id
}

resource "aws_ssm_parameter" "ses_secret_key" {
  name     = "/${local.ses}/secret_key"
  type     = "SecureString"
  value    = aws_iam_access_key.ses_user_key.secret
}

resource "aws_ssm_parameter" "ses_from_address" {
  name     = "/${local.ses}/from_address"
  type     = "SecureString"
  value    = "support@${local.email_zonename}"
}

resource "aws_ssm_parameter" "ses_replyto_address" {
  name     = "/${local.ses}/replyto_address"
  type     = "SecureString"
  value    = "support@${local.email_zonename}"
}