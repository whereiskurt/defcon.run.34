# ===========================================================================
# TRANSPORT — PENDING DECISION 1 (see README.md + the spec-corrections doc).
#
# The public ALB's security group accepts 443 ONLY from the CloudFront
# origin-facing prefix list (memory: reference_alb_cloudfront_only). So
# q.defcon.run CANNOT be reached direct-to-ALB — it MUST front through a
# CloudFront distribution (cache disabled, Host forwarded) whose origin is the
# ALB, which then forwards the q. host to the Lambda target group below.
#
# This file authors the NOVEL half — the ALB -> Lambda target group + host
# listener rule — behind `enable_transport` (DEFAULT false) so the module
# plans/applies the Lambdas + IAM + cron cleanly WITHOUT wiring public ingress
# until the decision is confirmed. The CloudFront distro for q. is intentionally
# NOT authored here yet: it should reuse the existing distro/cert conventions
# from modules/cloudfront-redirect once Decision 1 = A is locked. Do not flip
# enable_transport to true until that distro exists, or q. will be unreachable.
# ===========================================================================

resource "aws_lb_target_group" "resolver" {
  count       = var.enable_transport ? 1 : 0
  name        = substr("qr-resolver-${var.region.label}", 0, 32)
  target_type = "lambda"
  tags        = merge(local.common_tags, { Name = "qr-resolver-tg" })
}

resource "aws_lambda_permission" "allow_alb" {
  count         = var.enable_transport ? 1 : 0
  statement_id  = "AllowExecutionFromALB"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resolver.function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.resolver[0].arn
}

resource "aws_lb_target_group_attachment" "resolver" {
  count            = var.enable_transport ? 1 : 0
  target_group_arn = aws_lb_target_group.resolver[0].arn
  target_id        = aws_lambda_function.resolver.arn
  depends_on       = [aws_lambda_permission.allow_alb]
}

resource "aws_lb_listener_rule" "resolver_host" {
  count        = var.enable_transport ? 1 : 0
  listener_arn = var.alb_listener_arn
  priority     = var.alb_listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.resolver[0].arn
  }

  condition {
    host_header {
      values = [var.resolver_host]
    }
  }

  tags = merge(local.common_tags, { Name = "qr-resolver-host-rule" })
}

# ---------------------------------------------------------------------------
# CloudFront front door for q.defcon.run (Decision 1 = A).
#
# The public ALB accepts 443 ONLY from the CloudFront origin-facing prefix
# list, so q. cannot be reached direct-to-ALB. This distro fronts the ALB with
# caching disabled (every scan must reach the Lambda). It mirrors the EXACT
# origin config the run.human distro uses (modules/cloudfront: custom_origin_config
# https-only + X-Origin-Region header + Managed-AllViewerExceptHostHeader), under
# which run/auth/cms/gpx all route to distinct services off the shared ALB via
# host_header rules — so the ALB listener rule above (host_header = q.defcon.run)
# routes q. the same proven way. (Host-routing correctness is a runtime property,
# not something `plan` proves — verify with a curl smoke test after apply.)
# us-east-1-pinned CloudFront provider (CloudFront + its ACM cert are us-east-1).
# ---------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "resolver" {
  count = var.enable_transport ? 1 : 0

  enabled         = true
  is_ipv6_enabled = true
  comment         = "QR resolver front door ${var.resolver_host}"
  aliases         = [var.resolver_host]
  price_class     = "PriceClass_100"

  origin {
    domain_name = var.alb_dns_name
    origin_id   = "alb-resolver"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Same custom header the run.human ALB origin sets — lets the origin know
    # which edge/region served the request. Mirrored for config parity.
    custom_header {
      name  = "X-Origin-Region"
      value = var.region.label
    }
  }

  # CTF-13 — run.human origin for the q `/admin/*` behavior below. Mirrors the
  # alb-resolver origin config exactly (https-only + X-Origin-Region) but points
  # at the run.human public front door so Host resolves to run.human naturally.
  origin {
    domain_name = var.run_human_origin_domain
    origin_id   = "alb-run-human"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origin-Region"
      value = var.region.label
    }
  }

  # CTF-13 — peel `/admin/*` off to run.human so q.defcon.run/admin/leaderboard
  # renders the Phase-47 admin CTF leaderboard under run.human's ADMIN_GROUPS
  # (`admin`/`runadmin`) gate — without growing the resolver Lambda into an app
  # server. This ordered behavior sits ABOVE the default_cache_behavior below,
  # which is the resolver Lambda scan path and is DELIBERATELY LEFT UNTOUCHED as
  # the fallthrough (QR scans still 302 via the Lambda). CachingDisabled so the
  # per-admin leaderboard HTML is never cached at the edge; AllViewerExceptHost-
  # Header forwards the `.defcon.run` session cookie for the gate while rewriting
  # Host to run.human. NOTE: the exact `/use1` basePath rewrite (whether a
  # CloudFront viewer-request function is needed to map `/admin/*` ->
  # `/use1/admin/*`) is a runtime-verified concern documented in
  # DEPLOY-SPEC-ctf-admin.md — no rewrite function is added here; its necessity
  # and shape are apply-tested, not guessed into live-critical HCL.
  ordered_cache_behavior {
    path_pattern           = "/admin/*"
    target_origin_id       = "alb-run-human"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]

    # Managed-CachingDisabled — the gated admin page must never be cached.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # Managed-AllViewerExceptHostHeader — forward the `.defcon.run` session
    # cookie for the ADMIN_GROUPS gate while CloudFront rewrites Host to run.human.
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
  }

  default_cache_behavior {
    target_origin_id       = "alb-resolver"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]

    # Managed-CachingDisabled — every scan hits the Lambda (302s must not cache).
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    # Managed-AllViewerExceptHostHeader — forward everything but let CloudFront
    # rewrite Host to the origin, matching how run/auth/cms/gpx route off the ALB.
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
  }

  viewer_certificate {
    acm_certificate_arn      = var.cert_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = merge(var.tags, {
    Name   = "qr-resolver-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  })

  provider = aws.global-application
}

# Apex-zone ALIAS A record q.defcon.run -> the resolver CloudFront distro.
# q. is NOT a delegated subdomain, so the record lives in the apex defcon.run
# zone (management account) — hence provider = aws.global-management, mirroring
# modules/cloudfront-redirect's redirect_alias.
resource "aws_route53_record" "resolver_alias" {
  count = var.enable_transport ? 1 : 0

  zone_id = var.zone_id
  name    = var.resolver_host
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.resolver[0].domain_name
    zone_id                = aws_cloudfront_distribution.resolver[0].hosted_zone_id
    evaluate_target_health = false
  }

  provider = aws.global-management
}
