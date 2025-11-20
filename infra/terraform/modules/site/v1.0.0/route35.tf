data "aws_route53_zone" "mgmt" {
  name     = var.dns.zonename
  provider = aws.global-management
}

resource "aws_route53_zone" "account_zonenames" {
  for_each = toset(var.dns.subdomains)
  name     = "${each.key}.${var.dns.zonename}"
  provider = aws.global-application
}

resource "aws_route53_record" "forward_ns_to_zones" {
  for_each = aws_route53_zone.account_zonenames

  zone_id         = data.aws_route53_zone.mgmt.zone_id
  name            = each.value.name
  type            = "NS"
  ttl             = var.dns.ttl
  records         = each.value.name_servers
  allow_overwrite = true
  provider        = aws.global-management
}
