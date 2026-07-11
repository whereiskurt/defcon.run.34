locals {
  # subdomain label -> redirect object, e.g. "r" => {...}
  redirect_map = { for r in var.redirects : r.host => r }

  # Full human destination URL per host, e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ
  target_url = {
    for h, r in local.redirect_map :
    h => "https://${r.target_host}${r.target_path}${r.target_query != "" ? "?${r.target_query}" : ""}"
  }

  status_num  = { HTTP_301 = 301, HTTP_302 = 302 }
  status_desc = { HTTP_301 = "Moved Permanently", HTTP_302 = "Found" }

  # Rendered interstitial HTML per host: OG tags for crawlers + client redirect for humans.
  html = {
    for h, r in local.redirect_map :
    h => templatefile("${path.module}/assets/interstitial.html.tftpl", {
      og_title        = r.og.title
      og_description  = r.og.description
      og_image        = r.og.image
      page_url        = "https://${h}.${var.dns.zonename}/"
      target_url      = local.target_url[h]
      target_url_json = jsonencode(local.target_url[h])
    })
  }

  # Hosts that ship a local image file (from assets/) to upload under their prefix.
  image_uploads = {
    for h, r in local.redirect_map :
    h => r.og.image_file if try(r.og.image_file, null) != null
  }

  # Bucket name is prefixed with the site label so it matches the CI deploy
  # role's s3:PutObject grant (arn:aws:s3:::${site.label}-*, see site.hcl S3Assets).
  bucket_name = "${var.site.label}-redirect-pages-${var.site.random_suffix}"
}

# Private bucket holding each host's interstitial page + any local images.
# Read only by the CloudFront distributions below via OAC (no public access).
resource "aws_s3_bucket" "pages" {
  bucket   = local.bucket_name
  tags     = var.tags
  provider = aws.global-application
}

resource "aws_s3_bucket_public_access_block" "pages" {
  bucket                  = aws_s3_bucket.pages.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
  provider                = aws.global-application
}

resource "aws_cloudfront_origin_access_control" "pages" {
  name                              = "${var.site.label}-redirect-pages-oac"
  description                       = "OAC for vanity-redirect interstitial pages"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
  provider                          = aws.global-application
}

# Legacy edge-redirect functions from the pre-interstitial design. They are the
# functions currently LIVE on the distributions. Kept defined here (with byte-
# identical code, so terraform makes NO change to them) but deliberately
# UNASSOCIATED below, so the switch to the S3 origin removes the association
# without terraform ever issuing DeleteFunction on an in-use function (CloudFront
# returns 409 for that). Safe to remove in a follow-up once the distributions are
# fully on the S3 origin.
resource "aws_cloudfront_function" "redirect" {
  for_each = local.redirect_map

  name    = "${var.site.label}-redirect-${each.key}"
  runtime = "cloudfront-js-2.0"
  comment = "Edge redirect ${each.key}.${var.dns.zonename} -> ${local.target_url[each.key]}"
  publish = true

  code = <<-EOT
    function handler(event) {
      return {
        statusCode: ${local.status_num[each.value.status_code]},
        statusDescription: '${local.status_desc[each.value.status_code]}',
        headers: { 'location': { value: '${local.target_url[each.key]}' } }
      };
    }
  EOT

  provider = aws.global-application
}

# Interstitial page per host at s3://bucket/<host>/index.html
resource "aws_s3_object" "index" {
  for_each = local.redirect_map

  bucket       = aws_s3_bucket.pages.id
  key          = "${each.key}/index.html"
  content      = local.html[each.key]
  etag         = md5(local.html[each.key])
  content_type = "text/html; charset=utf-8"
  provider     = aws.global-application
}

# Local card image per host at s3://bucket/<host>/<file> (e.g. r/hackers.png)
resource "aws_s3_object" "image" {
  for_each = local.image_uploads

  bucket       = aws_s3_bucket.pages.id
  key          = "${each.key}/${each.value}"
  source       = "${path.module}/assets/${each.value}"
  etag         = filemd5("${path.module}/assets/${each.value}")
  content_type = "image/png"
  provider     = aws.global-application
}

# One CloudFront distribution per vanity host, fronting the private S3 page.
# The public ALB only accepts 443 from CloudFront, and CloudFront Functions
# cannot return an HTML body, so the unfurl card is served as a static S3 page.
resource "aws_cloudfront_distribution" "redirect" {
  for_each = local.redirect_map

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Vanity redirect ${each.key}.${var.dns.zonename}"
  aliases             = ["${each.key}.${var.dns.zonename}"]
  price_class         = "PriceClass_100"
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.pages.bucket_regional_domain_name
    origin_id                = "s3-redirect"
    origin_path              = "/${each.key}"
    origin_access_control_id = aws_cloudfront_origin_access_control.pages.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-redirect"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
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

# Grant only these distributions read access to the private bucket (OAC).
resource "aws_s3_bucket_policy" "pages" {
  bucket = aws_s3_bucket.pages.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.pages.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = [for d in aws_cloudfront_distribution.redirect : d.arn]
        }
      }
    }]
  })

  provider   = aws.global-application
  depends_on = [aws_cloudfront_distribution.redirect]
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
