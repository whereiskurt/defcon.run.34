data "aws_route53_zone" "email_zonename" {
  name     = var.email.zonename
  provider = aws.global-application
}

resource "aws_route53_record" "ses_verification_record" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = local.email_zonename
  type     = "TXT"
  ttl      = 600
  records  = [aws_ses_domain_identity.this.verification_token]
  provider = aws.global-application
}

resource "aws_route53_record" "ses_dkim_records" {
  for_each = toset(["0", "1", "2"])
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = "${aws_ses_domain_dkim.this.dkim_tokens[each.key]}._domainkey.${local.email_zonename}"
  type     = "CNAME"
  ttl      = 600
  records  = ["${aws_ses_domain_dkim.this.dkim_tokens[each.key]}.dkim.amazonses.com"]
  provider = aws.global-application
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = aws_ses_domain_mail_from.this.mail_from_domain
  type     = "MX"
  ttl      = 600
  records  = ["10 feedback-smtp.${var.region.full}.amazonses.com"]
  provider = aws.global-application

}

resource "aws_route53_record" "mail_from_txt" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = aws_ses_domain_mail_from.this.mail_from_domain
  type     = "TXT"
  ttl      = 600
  records  = ["v=spf1 include:amazonses.com -all"]
  provider = aws.global-application

}

resource "aws_route53_record" "dmarc_record" {
  zone_id = data.aws_route53_zone.email_zonename.zone_id
  name    = "_dmarc.${local.email_zonename}"
  type    = "TXT"
  ttl     = 600
  records = [
    "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${local.email_zonename}; ruf=mailto:dmarc-failures@${local.email_zonename}; sp=none; aspf=r;"
  ]
  provider = aws.global-application
}