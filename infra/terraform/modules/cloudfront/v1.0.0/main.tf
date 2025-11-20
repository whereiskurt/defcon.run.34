data "aws_caller_identity" "current" {}

resource "random_id" "rnd" {
  byte_length = 8
}

# S3 bucket for CloudFront logs (in us-east-1 with CloudFront)
resource "aws_s3_bucket" "cloudfront_logs" {
  count         = var.cloudfront.logging.enabled ? 1 : 0
  bucket        = "logs-cf-${replace(var.dns.zonename, ".", "-")}-${random_id.rnd.hex}"
  force_destroy = true

  tags = merge(
    var.tags,
    {
      Name        = "cloudfront-logs"
      Purpose     = "CloudFront Logs"
      Environment = var.site.label
    }
  )

  provider = aws.global-application
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_logs_ownership" {
  count    = var.cloudfront.logging.enabled ? 1 : 0
  bucket   = aws_s3_bucket.cloudfront_logs[0].id
  provider = aws.global-application

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "cloudfront_logs_acl" {
  count      = var.cloudfront.logging.enabled ? 1 : 0
  depends_on = [aws_s3_bucket_ownership_controls.cloudfront_logs_ownership]
  bucket     = aws_s3_bucket.cloudfront_logs[0].id
  acl        = "private"
  provider   = aws.global-application
}

# Origin Access Control for S3 buckets
resource "aws_cloudfront_origin_access_control" "cf_oac" {
  for_each                          = var.regional_origins
  name                              = "oac-${each.key}-${var.dns.zonename}"
  description                       = "OAC for ${each.key} S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"

  provider = aws.global-application
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Multi-region distribution for ${var.cloudfront.domains[0]}.${var.dns.zonename}"
  default_root_object = ""
  price_class         = var.cloudfront.price_class
  aliases             = ["${var.cloudfront.domains[0]}.${var.dns.zonename}"]

  # Ensure S3 logs bucket ACL is configured before creating distribution
  depends_on = [aws_s3_bucket_acl.cloudfront_logs_acl]

  # Dynamic origins for ALBs
  dynamic "origin" {
    for_each = var.regional_origins
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

  # Dynamic origins for S3 buckets
  dynamic "origin" {
    for_each = var.regional_origins
    content {
      domain_name              = origin.value.s3_bucket_regional_domain_name
      origin_id                = "s3-${origin.key}"
      origin_access_control_id = aws_cloudfront_origin_access_control.cf_oac[origin.key].id
    }
  }

  # Default cache behavior - routes to first region's ALB
  default_cache_behavior {
    target_origin_id       = "alb-${keys(var.regional_origins)[0]}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewerExceptHostHeader
  }

  # Ordered cache behaviors for regional ALB routing
  # Pattern: /{region_label}/* routes to ALB
  dynamic "ordered_cache_behavior" {
    for_each = var.regional_origins
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

  # Ordered cache behaviors for regional S3 asset routing
  # Pattern: /{region_label}/assets/* routes to S3
  dynamic "ordered_cache_behavior" {
    for_each = var.regional_origins
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

  # Viewer certificate
  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
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
      bucket          = aws_s3_bucket.cloudfront_logs[0].bucket_domain_name
      include_cookies = var.cloudfront.logging.include_cookies
      prefix          = "cloudfront/"
    }
  }

  # WAF Web ACL
  web_acl_id = var.waf_web_acl_arn

  tags = merge(
    var.tags,
    {
      Name        = "${var.cloudfront.domains[0]}.${var.dns.zonename}"
      Purpose     = "CloudFront Distribution"
      Environment = var.site.label
    }
  )

  provider = aws.global-application
}
