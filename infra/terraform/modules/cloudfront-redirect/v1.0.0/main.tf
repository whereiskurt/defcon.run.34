locals {
  # subdomain label -> redirect object, e.g. "r" => {...}
  redirect_map = { for r in var.redirects : r.host => r }

  status_num  = { HTTP_301 = 301, HTTP_302 = 302 }
  status_desc = { HTTP_301 = "Moved Permanently", HTTP_302 = "Found" }

  # Full destination URL per host, e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ
  location = {
    for h, r in local.redirect_map :
    h => "https://${r.target_host}${r.target_path}${r.target_query != "" ? "?${r.target_query}" : ""}"
  }
}

# One edge-redirect function per host. Returning a response object at
# viewer-request short-circuits the request, so the origin below is never
# contacted — the redirect is served entirely at the CloudFront edge.
resource "aws_cloudfront_function" "redirect" {
  for_each = local.redirect_map

  name    = "${var.site.label}-redirect-${each.key}"
  runtime = "cloudfront-js-2.0"
  comment = "Edge redirect ${each.key}.${var.dns.zonename} -> ${local.location[each.key]}"
  publish = true

  code = <<-EOT
    function handler(event) {
      return {
        statusCode: ${local.status_num[each.value.status_code]},
        statusDescription: '${local.status_desc[each.value.status_code]}',
        headers: { 'location': { value: '${local.location[each.key]}' } }
      };
    }
  EOT

  provider = aws.global-application
}

# One CloudFront distribution per vanity host. The public ALB only accepts 443
# from CloudFront, so these hosts must front through CloudFront; the function
# above serves the redirect at the edge. The origin is a formality (never
# contacted) — pointed at the redirect target so it is a sane, resolvable
# fallback rather than a fake domain.
resource "aws_cloudfront_distribution" "redirect" {
  for_each = local.redirect_map

  enabled         = true
  is_ipv6_enabled = true
  comment         = "Vanity redirect ${each.key}.${var.dns.zonename}"
  aliases         = ["${each.key}.${var.dns.zonename}"]
  price_class     = "PriceClass_100"

  origin {
    domain_name = each.value.target_host
    origin_id   = "redirect-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "redirect-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.redirect[each.key].arn
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.cert_map[var.dns.zonename].arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = merge(var.tags, {
    Name   = "redirect-${each.key}"
    Region = var.region.label
    Site   = var.site.label
  })

  provider = aws.global-application
}

# Apex-zone ALIAS A record per host -> its CloudFront distribution.
# r./h. are NOT delegated subdomains, so records live in the apex defcon.run
# zone (management account) — hence provider = aws.global-management.
resource "aws_route53_record" "redirect_alias" {
  for_each = local.redirect_map

  zone_id = var.zone_map[var.dns.zonename].zone_id
  name    = "${each.key}.${var.dns.zonename}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.redirect[each.key].domain_name
    zone_id                = aws_cloudfront_distribution.redirect[each.key].hosted_zone_id
    evaluate_target_health = false
  }

  provider = aws.global-management
}
