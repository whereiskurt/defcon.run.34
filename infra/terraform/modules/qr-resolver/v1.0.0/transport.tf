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
