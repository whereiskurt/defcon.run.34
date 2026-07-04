data "aws_caller_identity" "current" {}

locals {
  fqdn   = "${var.subdomain}.${var.dns.zonename}" # e.g. status.defcon.run
  prefix = var.region_label                       # e.g. use1  → content served under /use1/
}

resource "random_id" "rnd" {
  byte_length = 6
}

########################################
# S3 bucket (private, OAC-only origin)
########################################
resource "aws_s3_bucket" "site" {
  bucket        = "status-${var.site.label}-${var.region_label}-${random_id.rnd.hex}"
  force_destroy = true

  tags = merge(var.tags, {
    Name    = local.fqdn
    Purpose = "Status static site"
  })
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Suspended"
  }
}

########################################
# ACM certificate (us-east-1, application account)
# DNS validation records go in the apex zone (management account)
########################################
resource "aws_acm_certificate" "cert" {
  domain_name       = local.fqdn
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = var.tags
}

resource "aws_route53_record" "cert_validation" {
  provider = aws.management

  for_each = {
    for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id         = var.apex_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cert" {
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

########################################
# CloudFront: OAC, router function, distribution
########################################
resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "status-${var.site.label}-${var.region_label}-oac"
  description                       = "OAC for ${local.fqdn}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Viewer-request function: forward "/" to "/<prefix>/" and add index.html to directory URIs
resource "aws_cloudfront_function" "router" {
  name    = "status-${var.site.label}-${var.region_label}-router"
  runtime = "cloudfront-js-2.0"
  comment = "Redirect / to /${local.prefix}/ and resolve directory index"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var req = event.request;
      var uri = req.uri;
      if (uri === '/' || uri === '') {
        return {
          statusCode: 302,
          statusDescription: 'Found',
          headers: { 'location': { value: '/${local.prefix}/' } }
        };
      }
      if (uri.endsWith('/')) {
        req.uri = uri + 'index.html';
      }
      return req;
    }
  EOT
}

# Managed cache policy for the hard-cached HTML/asset shell
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Short-lived cache policy for the frequently-updated *.json data files
resource "aws_cloudfront_cache_policy" "shortlived" {
  name        = "status-${var.site.label}-${var.region_label}-shortlived"
  comment     = "Short TTL for status.json / marquee.json"
  default_ttl = var.json_default_ttl
  min_ttl     = 0
  max_ttl     = var.json_max_ttl

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = local.fqdn
  default_root_object = "${local.prefix}/index.html"
  aliases             = [local.fqdn]
  price_class         = var.price_class

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-status"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-status"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.router.arn
    }
  }

  ordered_cache_behavior {
    path_pattern           = "*.json"
    target_origin_id       = "s3-status"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.shortlived.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cert.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/${local.prefix}/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/${local.prefix}/index.html"
    error_caching_min_ttl = 10
  }

  tags = merge(var.tags, { Name = local.fqdn })
}

########################################
# S3 bucket policy: allow this CloudFront distribution via OAC
########################################
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn
        }
      }
    }]
  })
}

########################################
# DNS: alias records in the apex zone (management account)
########################################
resource "aws_route53_record" "a" {
  provider = aws.management
  zone_id  = var.apex_zone_id
  name     = local.fqdn
  type     = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "aaaa" {
  provider = aws.management
  zone_id  = var.apex_zone_id
  name     = local.fqdn
  type     = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

########################################
# SSM params so release.sh can find the bucket + distribution
########################################
resource "aws_ssm_parameter" "bucket" {
  name  = "/${var.site.label}/status-site/bucket"
  type  = "String"
  value = aws_s3_bucket.site.bucket
  tags  = var.tags
}

resource "aws_ssm_parameter" "distribution_id" {
  name  = "/${var.site.label}/status-site/distribution_id"
  type  = "String"
  value = aws_cloudfront_distribution.cdn.id
  tags  = var.tags
}

resource "aws_ssm_parameter" "content_prefix" {
  name  = "/${var.site.label}/status-site/content_prefix"
  type  = "String"
  value = local.prefix
  tags  = var.tags
}
