output "request_function_arn" {
  description = "ARN of the viewer-request region-prefix CloudFront Function, or \"\" when disabled. Associate on a distribution's viewer-request."
  value       = var.enabled ? aws_cloudfront_function.region_prefix[0].arn : ""
}

output "response_function_arn" {
  description = "ARN of the viewer-response sticky-cookie CloudFront Function, or \"\" when single-region/disabled. Associate on viewer-response only when non-empty."
  value       = var.enabled && local.geo_enabled ? aws_cloudfront_function.region_cookie[0].arn : ""
}

output "geo_enabled" {
  description = "Whether the geo/cookie lookup is active (true) or the cheap static-default prefix is used (false)."
  value       = local.geo_enabled
}

output "enabled" {
  description = "Whether any function was created."
  value       = var.enabled
}
