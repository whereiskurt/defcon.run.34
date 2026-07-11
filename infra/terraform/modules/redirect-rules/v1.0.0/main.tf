locals {
  # subdomain label -> redirect object, e.g. "r" => {...}
  redirect_map = { for r in var.redirects : r.host => r }
}

# Host-based redirect rules on the EXISTING ALB HTTPS listener. The ALB answers
# the redirect itself — no target group, no ECS, no Lambda.
resource "aws_lb_listener_rule" "redirect" {
  for_each = local.redirect_map

  listener_arn = var.alb_listener_arn
  priority     = each.value.priority

  condition {
    host_header {
      values = ["${each.key}.${var.dns.zonename}"]
    }
  }

  action {
    type = "redirect"
    redirect {
      host        = each.value.target_host
      path        = each.value.target_path
      query       = each.value.target_query
      port        = "443"
      protocol    = "HTTPS"
      status_code = each.value.status_code
    }
  }

  tags = merge(var.tags, {
    Name   = "redirect-${each.key}"
    Region = var.region.label
    Site   = var.site.label
  })
}

# Apex-zone ALIAS A records for each redirect host -> the ALB.
# r./h. are NOT delegated subdomains, so records live in the apex defcon.run
# zone (management account) — hence provider = aws.global-management.
resource "aws_route53_record" "redirect_alias" {
  for_each = local.redirect_map

  zone_id = var.zone_map[var.dns.zonename].zone_id
  name    = "${each.key}.${var.dns.zonename}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = false
  }

  provider = aws.global-management
}
