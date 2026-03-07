resource "aws_route53_record" "nlb_alias" {
  provider = aws.global-application

  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  set_identifier = var.region.label

  alias {
    name                   = var.nlb_dns_name
    zone_id                = var.nlb_zone_id
    evaluate_target_health = true
  }

  latency_routing_policy {
    region = var.region.full
  }
}
