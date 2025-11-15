locals {
  ses = "${var.site.label}/ses"
}

resource "aws_ssm_parameter" "email_zonenames" {
  name  = "/${local.ses}/zonenames"
  type  = "StringList"
  value = join(",", var.email.zonenames)
}

resource "aws_ssm_parameter" "make_regional_domains" {
  name  = "/${local.ses}/make_regional_domains"
  type  = "String"
  value = var.email.make_regional_domains
}
resource "aws_ssm_parameter" "make_site_domain" {
  name  = "/${local.ses}/make_site_domain"
  type  = "String"
  value = var.email.make_site_domain
}

resource "aws_ssm_parameter" "make_domains" {
  name  = "/${local.ses}/make_domains"
  type  = "String"
  value = var.email.make_domains
}

resource "aws_ssm_parameter" "aws_emailuri" {
  name  = "/${local.ses}/awsuri"
  type  = "String"
  value = "https://email.${var.region.full}.amazonaws.com"
}

resource "aws_ssm_parameter" "smtp_host" {
  name  = "/${local.ses}/smtp_host"
  type  = "String"
  value = "email-smtp.${var.region.full}.amazonaws.com"
}

resource "aws_ssm_parameter" "ses_from_address" {
  name  = "/${local.ses}/from_address"
  type  = "String"
  value = "support@${var.email.zonenames[0]}"
}

resource "aws_ssm_parameter" "ses_replyto_address" {
  name  = "/${local.ses}/replyto_address"
  type  = "String"
  value = "reply-to@${var.email.zonenames[0]}"
}

# SMTP credentials for individual email addresses
# Supports both email format (user@domain.com) and simple usernames (strapi)
locals {
  # Create a map with the proper path structure for each user
  smtp_user_paths = {
    for user in var.smtp_iam_users :
    user => contains(split("", user), "@") ? {
      domain   = split("@", user)[1]
      username = split("@", user)[0]
      path     = "${split("@", user)[1]}/${split("@", user)[0]}"
    } : {
      domain   = "default"
      username = user
      path     = "default/${user}"
    }
  }
}

resource "aws_ssm_parameter" "smtp_credential_username" {
  for_each = toset(var.smtp_iam_users)
  name     = "/${local.ses}/smtp/${local.smtp_user_paths[each.value].path}/username"
  type     = "SecureString"
  value    = aws_iam_access_key.smtp_credential_keys[each.key].id
  tags = {
    Email = each.value
  }
}

resource "aws_ssm_parameter" "smtp_credential_password" {
  for_each = toset(var.smtp_iam_users)
  name     = "/${local.ses}/smtp/${local.smtp_user_paths[each.value].path}/password"
  type     = "SecureString"
  value    = aws_iam_access_key.smtp_credential_keys[each.key].ses_smtp_password_v4
  tags = {
    Email = each.value
  }
}

resource "aws_ssm_parameter" "smtp_credential_url" {
  for_each = toset(var.smtp_iam_users)
  name     = "/${local.ses}/smtp/${local.smtp_user_paths[each.value].path}/url"
  type     = "SecureString"
  ##The replace is necessary because an IAM access key ID cannot contain slashes
  ##Slashes aren't URL friendly. Other chars like + are handled fine by most URL parsers but the '/' is not.
  value = "smtp://${aws_iam_access_key.smtp_credential_keys[each.key].id}:${replace(aws_iam_access_key.smtp_credential_keys[each.key].ses_smtp_password_v4, "/", "%2F")}@email-smtp.${var.region.full}.amazonaws.com:587"
  tags = {
    Email = each.value
  }
}

# Email forwarding configuration
resource "aws_ssm_parameter" "fwd_rules_rules" {
  count = length(var.fwd_rules) > 0 ? 1 : 0
  name  = "/${local.ses}/forwarding/rules"
  type  = "String"
  value = jsonencode({
    for rule in var.fwd_rules :
    rule.match => rule.send_to
  })
  description = "Email forwarding rules mapping custom domain addresses to external addresses"
}
