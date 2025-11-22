data "aws_caller_identity" "current" {}

resource "random_id" "rnd" {
  byte_length = 8
}

# Local to create a set of domains for for_each loops
locals {
  # Create a set from the domains list for for_each
  domain_set = toset(var.cloudfront.domains)
}

# S3 bucket for CloudFront logs (in us-east-1 with CloudFront)
# One bucket per domain
resource "aws_s3_bucket" "cloudfront_logs" {
  for_each = var.cloudfront.logging.enabled ? local.domain_set : toset([])

  bucket        = "logs-cf-${each.key}-${replace(var.dns.zonename, ".", "-")}-${random_id.rnd.hex}"
  force_destroy = true

  tags = merge(
    var.tags,
    {
      Name        = "cloudfront-logs-${each.key}"
      Purpose     = "CloudFront Logs"
      Environment = var.site.label
      Domain      = "${each.key}.${var.dns.zonename}"
    }
  )

  provider = aws.global-application
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_logs_ownership" {
  for_each = var.cloudfront.logging.enabled ? local.domain_set : toset([])

  bucket   = aws_s3_bucket.cloudfront_logs[each.key].id
  provider = aws.global-application

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "cloudfront_logs_acl" {
  for_each = var.cloudfront.logging.enabled ? local.domain_set : toset([])

  depends_on = [aws_s3_bucket_ownership_controls.cloudfront_logs_ownership]
  bucket     = aws_s3_bucket.cloudfront_logs[each.key].id
  acl        = "private"
  provider   = aws.global-application
}

# Origin Access Control for S3 buckets
# Create one OAC per domain per region
resource "aws_cloudfront_origin_access_control" "cf_oac" {
  for_each = merge([
    for domain in var.cloudfront.domains : {
      for region_key in keys(var.regional_origins_by_domain[domain]) :
      "${domain}-${region_key}" => {
        domain = domain
        region = region_key
      }
    }
  ]...)

  name                              = "oac-${each.value.domain}-${each.value.region}-${var.dns.zonename}"
  description                       = "OAC for ${each.value.domain} ${each.value.region} S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"

  provider = aws.global-application
}

# CloudFront Distribution - one per domain
resource "aws_cloudfront_distribution" "main" {
  for_each = local.domain_set

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Multi-region distribution for ${each.key}.${var.dns.zonename}"
  default_root_object = ""
  price_class         = var.cloudfront.price_class
  aliases             = ["${each.key}.${var.dns.zonename}"]

  # Ensure S3 logs bucket ACL is configured before creating distribution
  depends_on = [aws_s3_bucket_acl.cloudfront_logs_acl]

  # Dynamic origins for ALBs - use this domain's regional origins
  dynamic "origin" {
    for_each = var.regional_origins_by_domain[each.key]
    content {
      domain_name = origin.value.alb_dns_name
      origin_id   = "alb-${origin.key}"

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }

      custom_header {
        name  = "X-Origin-Region"
        value = origin.key
      }
    }
  }

  # Dynamic origins for S3 buckets - use this domain's regional origins
  dynamic "origin" {
    for_each = var.regional_origins_by_domain[each.key]
    content {
      domain_name              = origin.value.s3_bucket_regional_domain_name
      origin_id                = "s3-${origin.key}"
      origin_access_control_id = aws_cloudfront_origin_access_control.cf_oac["${each.key}-${origin.key}"].id
    }
  }

  # Default cache behavior - routes to first region's ALB for this domain
  default_cache_behavior {
    target_origin_id       = "alb-${keys(var.regional_origins_by_domain[each.key])[0]}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewerExceptHostHeader
  }

  # Ordered cache behaviors for regional S3 asset routing
  # IMPORTANT: This must come BEFORE the ALB wildcard patterns
  # Pattern: /{region_label}/assets/* routes to S3 for this domain
  dynamic "ordered_cache_behavior" {
    for_each = var.regional_origins_by_domain[each.key]
    content {
      path_pattern           = "/${ordered_cache_behavior.key}/assets/*"
      target_origin_id       = "s3-${ordered_cache_behavior.key}"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
    }
  }

  # Ordered cache behaviors for regional ALB routing
  # Pattern: /{region_label}/* routes to ALB for this domain
  dynamic "ordered_cache_behavior" {
    for_each = var.regional_origins_by_domain[each.key]
    content {
      path_pattern           = "/${ordered_cache_behavior.key}/*"
      target_origin_id       = "alb-${ordered_cache_behavior.key}"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
      origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
    }
  }

  # Viewer certificate
  # Look up certificate ARN for this specific domain
  viewer_certificate {
    acm_certificate_arn      = var.cert_map["${each.key}.${var.dns.zonename}"].arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # Restrictions
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Logging configuration
  dynamic "logging_config" {
    for_each = var.cloudfront.logging.enabled ? [1] : []
    content {
      bucket          = aws_s3_bucket.cloudfront_logs[each.key].bucket_domain_name
      include_cookies = var.cloudfront.logging.include_cookies
      prefix          = "cloudfront/"
    }
  }

  # WAF Web ACL
  web_acl_id = var.waf_web_acl_arn

  tags = merge(
    var.tags,
    {
      Name        = "${each.key}.${var.dns.zonename}"
      Purpose     = "CloudFront Distribution"
      Environment = var.site.label
      Domain      = "${each.key}.${var.dns.zonename}"
    }
  )

  provider = aws.global-application
}
