# SES Domain Verification TXT Record (uses route53 provider)
resource "aws_route53_record" "ses_verification" {
  zone_id  = var.route53_zone_id
  name     = var.domain_name
  type     = "TXT"
  ttl      = 600
  records  = [aws_ses_domain_identity.this.verification_token]
  provider = aws.global-management
}

# SES DKIM CNAME Records (uses route53 provider)
resource "aws_route53_record" "ses_dkim" {
  for_each = toset(["0", "1", "2"])
  zone_id  = var.route53_zone_id
  name     = "${aws_ses_domain_dkim.this.dkim_tokens[each.key]}._domainkey.${var.domain_name}"
  type     = "CNAME"
  ttl      = 600
  records  = ["${aws_ses_domain_dkim.this.dkim_tokens[each.key]}.dkim.amazonses.com"]
  provider = aws.global-management
}

# MX Record for Mail From Domain (only for regional/sending) (uses route53 provider)
resource "aws_route53_record" "mail_from_mx" {
  count    = var.enable_mail_from_mx && var.mail_from_domain != "" ? 1 : 0
  zone_id  = var.route53_zone_id
  name     = try(aws_ses_domain_mail_from.this_with_primary[0].mail_from_domain, aws_ses_domain_mail_from.this_without_primary[0].mail_from_domain)
  type     = "MX"
  ttl      = 600
  records  = ["10 feedback-smtp.${var.region}.amazonses.com"]
  provider = aws.global-management
}

# TXT Record for Mail From Domain SPF (uses route53 provider)
resource "aws_route53_record" "mail_from_txt" {
  count    = var.mail_from_domain != "" ? 1 : 0
  zone_id  = var.route53_zone_id
  name     = try(aws_ses_domain_mail_from.this_with_primary[0].mail_from_domain, aws_ses_domain_mail_from.this_without_primary[0].mail_from_domain)
  type     = "TXT"
  ttl      = 600
  records  = ["v=spf1 include:amazonses.com ~all"]
  provider = aws.global-management
}

# DMARC Record (uses route53 provider)
resource "aws_route53_record" "dmarc" {
  zone_id = var.route53_zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [
    "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${var.domain_name}; ruf=mailto:dmarc-failures@${var.domain_name}; sp=none; aspf=r; adkim=r;"
  ]
  provider = aws.global-management
}

# MX Record for Receiving Emails (uses route53 provider)
resource "aws_route53_record" "receive_mx" {
  count    = var.enable_receive_mx ? 1 : 0
  zone_id  = var.route53_zone_id
  name     = var.domain_name
  type     = "MX"
  ttl      = 600
  records  = ["10 inbound-smtp.${var.region}.amazonaws.com"]
  provider = aws.global-management
}
