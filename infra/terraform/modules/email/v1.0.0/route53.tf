data "aws_route53_zone" "email_zonename" {
  name     = var.email.zonename
  provider = aws.global-application
}

resource "aws_route53_record" "ses_verification_record" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = local.region_zonename
  type     = "TXT"
  ttl      = 600
  records  = [aws_ses_domain_identity.this.verification_token]
  provider = aws.global-application
}

resource "aws_route53_record" "ses_dkim_records" {
  for_each = toset(["0", "1", "2"])
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = "${aws_ses_domain_dkim.this.dkim_tokens[each.key]}._domainkey.${local.region_zonename}"
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
  name    = "_dmarc.${local.region_zonename}"
  type    = "TXT"
  ttl     = 600
  records = [
    "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${local.region_zonename}; ruf=mailto:dmarc-failures@${local.region_zonename}; sp=none; aspf=r; adkim=r;"
  ]
  provider = aws.global-application
}

# MX record for receiving emails via SES
resource "aws_route53_record" "receive_mx" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = local.region_zonename
  type     = "MX"
  ttl      = 600
  records  = ["10 inbound-smtp.${var.region.full}.amazonaws.com"]
  provider = aws.global-application
}

# SPF record for receiving emails at regional domain
# resource "aws_route53_record" "spf_regional" {
#   zone_id  = data.aws_route53_zone.email_zonename.zone_id
#   name     = aws_ses_domain_mail_from.this.mail_from_domain
#   type     = "TXT"
#   ttl      = 600
#   records  = ["v=spf1 include:amazonses.com ~all"]
#   provider = aws.global-application
# }

########################################### 

# SES verification for root domain (email.defcon.run)
resource "aws_route53_record" "ses_verification_record_root" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = var.email.zonename
  type     = "TXT"
  ttl      = 600
  records  = [aws_ses_domain_identity.root.verification_token]
  provider = aws.global-application
}

# DKIM records for root domain (emaildefcon.run)
resource "aws_route53_record" "ses_dkim_records_root" {
  for_each = toset(["0", "1", "2"])
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = "${aws_ses_domain_dkim.root.dkim_tokens[each.key]}._domainkey.${var.email.zonename}"
  type     = "CNAME"
  ttl      = 600
  records  = ["${aws_ses_domain_dkim.root.dkim_tokens[each.key]}.dkim.amazonses.com"]
  provider = aws.global-application
}

# MX record for receiving emails at root domain (email.defcon.run)
resource "aws_route53_record" "receive_mx_root" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = var.email.zonename
  type     = "MX"
  ttl      = 600
  records  = ["10 inbound-smtp.${var.region.full}.amazonaws.com"]
  provider = aws.global-application
}

# SPF record for receiving emails at root email domain
resource "aws_route53_record" "spf_root" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name     = aws_ses_domain_mail_from.root.mail_from_domain
  type     = "TXT"
  ttl      = 600
  records  = ["v=spf1 include:amazonses.com ~all"]
  provider = aws.global-application
}

resource "aws_route53_record" "dmarc_record_root" {
  zone_id  = data.aws_route53_zone.email_zonename.zone_id
  name    = "_dmarc.${var.email.zonename}"
  type    = "TXT"
  ttl     = 600
  records = [
    "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${var.email.zonename}; ruf=mailto:dmarc-failures@${var.email.zonename}; sp=none; aspf=r; adkim=r;"
  ]
  provider = aws.global-application
}

####################################
## global-management
data "aws_route53_zone" "mgmt" {
  name     = var.dns.zonename
  provider = aws.global-management
}

# SES verification for root domain (email.defcon.run)
resource "aws_route53_record" "ses_verification_record_mgmt" {
  zone_id  = data.aws_route53_zone.mgmt.zone_id
  name     = var.dns.zonename
  type     = "TXT"
  ttl      = 600
  records  = [aws_ses_domain_identity.mgmt.verification_token]
  provider = aws.global-management
}
resource "aws_route53_record" "spf_mgmt" {
  zone_id  = data.aws_route53_zone.mgmt.zone_id
  name     = aws_ses_domain_mail_from.mgmt.mail_from_domain
  type     = "TXT"
  ttl      = 600
  records  = ["v=spf1 include:amazonses.com ~all"]
  provider = aws.global-management
}


# DKIM records for root domain (emaildefcon.run)
resource "aws_route53_record" "ses_dkim_records_mgmt" {
  for_each = toset(["0", "1", "2"])
  zone_id  = data.aws_route53_zone.mgmt.zone_id
  name     = "${aws_ses_domain_dkim.mgmt.dkim_tokens[each.key]}._domainkey.${var.dns.zonename}"
  type     = "CNAME"
  ttl      = 600
  records  = ["${aws_ses_domain_dkim.mgmt.dkim_tokens[each.key]}.dkim.amazonses.com"]
  provider = aws.global-management
}

# MX record for receiving emails at root domain (email.defcon.run)
resource "aws_route53_record" "receive_mx_mgmt" {
  zone_id  = data.aws_route53_zone.mgmt.zone_id
  name     = "${var.email.smtp_prefix}.${var.dns.zonename}"
  type     = "MX"
  ttl      = 600
  records  = ["10 inbound-smtp.${var.region.full}.amazonaws.com"]
  provider = aws.global-management
}

resource "aws_route53_record" "dmarc_record_mgmt" {
  zone_id  = data.aws_route53_zone.mgmt.zone_id
  name    = "_dmarc.${var.dns.zonename}"
  type    = "TXT"
  ttl     = 600
  records = [
    "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${var.dns.zonename}; ruf=mailto:dmarc-failures@${var.dns.zonename}; sp=none; aspf=r; adkim=r;"
  ]
  provider = aws.global-management
}

# resource "aws_route53_record" "spf_mgmt" {
#   zone_id  = data.aws_route53_zone.mgmt.zone_id
#   name     = aws_ses_domain_mail_from.mgmt.mail_from_domain
#   type     = "TXT"
#   ttl      = 600
#   records  = ["v=spf1 include:amazonses.com ~all"]
#   provider = aws.global-management
# }
