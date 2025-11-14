locals {
  ses = "${var.site.label}/ses"
}

resource "aws_ssm_parameter" "email_zonenames" {
  name     = "/${local.ses}/zonenames"
  type     = "StringList"
  value    = join(",", var.email.zonenames)
}

resource "aws_ssm_parameter" "use_smtp_region" {
  name     = "/${local.ses}/use_smtp_region"
  type     = "String"
  value    = var.use_smtp_region
}
resource "aws_ssm_parameter" "use_smtp_site" {
  name     = "/${local.ses}/use_smtp_site"
  type     = "String"
  value    = var.use_smtp_site
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
  type     = "SecureString"
  value    = aws_iam_access_key.ses_user_key.id
}

resource "aws_ssm_parameter" "ses_secret_key" {
  name     = "/${local.ses}/secret_key"
  type     = "SecureString"
  value    = aws_iam_access_key.ses_user_key.secret
}

resource "aws_ssm_parameter" "ses_from_address" {
  name     = "/${local.ses}/from_address"
  type     = "String"
  value    = "support@${var.email.zonenames[0]}"
}

resource "aws_ssm_parameter" "ses_replyto_address" {
  name     = "/${local.ses}/replyto_address"
  type     = "String"
  value    = "reply-to@${var.email.zonenames[0]}"
}

# SMTP credentials for individual email addresses
resource "aws_ssm_parameter" "smtp_credential_username" {
  for_each = toset(var.smtp_credentials)
  name     = "/${local.ses}/smtp/${split("@", each.value)[1]}/${split("@", each.value)[0]}/username"
  type     = "SecureString"
  value    = aws_iam_access_key.smtp_credential_keys[each.key].id
  tags = {
    Email = each.value
  }
}

resource "aws_ssm_parameter" "smtp_credential_password" {
  for_each = toset(var.smtp_credentials)
  name     = "/${local.ses}/smtp/${split("@", each.value)[1]}/${split("@", each.value)[0]}/password"
  type     = "SecureString"
  value    = aws_iam_access_key.smtp_credential_keys[each.key].ses_smtp_password_v4
  tags = {
    Email = each.value
  }
}

resource "aws_ssm_parameter" "smtp_credential_url" {
  for_each = toset(var.smtp_credentials)
  name     = "/${local.ses}/smtp/${split("@", each.value)[1]}/${split("@", each.value)[0]}/url"
  type     = "SecureString"
  ##The replace is necessary because an IAM access key ID cannot contain slashes
  ##Slashes aren't URL friendly. Other chars like + are handled fine by most URL parsers but the '/' is not.
  value    = "smtp://${aws_iam_access_key.smtp_credential_keys[each.key].id}:${replace(aws_iam_access_key.smtp_credential_keys[each.key].ses_smtp_password_v4, "/", "%2F")}@email-smtp.${var.region.full}.amazonaws.com:587"
  tags = {
    Email = each.value
  }
}

# Email forwarding configuration
resource "aws_ssm_parameter" "email_forwarding_rules" {
  count = length(var.email_forwarding) > 0 ? 1 : 0
  name  = "/${local.ses}/forwarding/rules"
  type  = "String"
  value = jsonencode({
    for rule in var.email_forwarding :
    rule.from_address => rule.to_address
  })
  description = "Email forwarding rules mapping custom domain addresses to external addresses"
}