# # Route53 A record (alias) pointing to CloudFront distribution
resource "aws_route53_record" "cloudfront_alias" {
  zone_id = var.zone_id
  name    = "${var.cloudfront.domains[0]}.${var.dns.zonename}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }

  provider = aws.global-application
}
