locals {
  # Geo lookup turns on only when more than one region serves, unless the
  # caller forces it via var.geo_enabled. On a single-region deploy the smart
  # lookup is pointless (everything routes to the one region), so we drop to a
  # cheap static default prefix.
  geo_enabled = var.geo_enabled != null ? var.geo_enabled : length(var.served_regions) > 1

  regions_json     = jsonencode(var.served_regions)
  country_map_json = jsonencode(var.country_region_map)
}

# Viewer-request: prepend "/<region>" when the path lacks a served-region
# segment. Always created when enabled (single- or multi-region).
resource "aws_cloudfront_function" "region_prefix" {
  count   = var.enabled ? 1 : 0
  name    = substr("region-prefix-${var.name_suffix}", 0, 64)
  runtime = "cloudfront-js-2.0"
  comment = local.geo_enabled ? "Region prefixer (geo+cookie+default)" : "Region prefixer (static ${var.default_region})"
  publish = true

  code = templatefile("${path.module}/assets/region-prefix.js.tftpl", {
    regions_json     = local.regions_json
    default_region   = var.default_region
    cookie_name      = var.cookie_name
    geo_enabled      = local.geo_enabled ? "true" : "false"
    country_map_json = local.country_map_json
  })
}

# Viewer-response: set the sticky-region cookie. Only meaningful (and only
# created) on MULTI-region deploys — matches "disable on single region".
resource "aws_cloudfront_function" "region_cookie" {
  count   = var.enabled && local.geo_enabled ? 1 : 0
  name    = substr("region-cookie-${var.name_suffix}", 0, 64)
  runtime = "cloudfront-js-2.0"
  comment = "Region sticky-cookie setter (viewer-response); multi-region only"
  publish = true

  code = templatefile("${path.module}/assets/region-cookie.js.tftpl", {
    regions_json = local.regions_json
    cookie_name  = var.cookie_name
  })
}
