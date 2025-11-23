# AWS WAF Web ACL for CloudFront (must be created in us-east-1)
resource "aws_wafv2_web_acl" "this" {
  count       = var.enabled ? 1 : 0
  name        = "${var.site_label}-${var.ruleset_name}"
  description = "WAF Web ACL ${var.ruleset_name} for ${var.site_label}"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # AWS Managed Rules
  dynamic "rule" {
    for_each = var.managed_rules
    content {
      name     = rule.value.name
      priority = rule.value.priority

      override_action {
        dynamic "none" {
          for_each = rule.value.override_action == "none" ? [1] : []
          content {}
        }
        dynamic "count" {
          for_each = rule.value.override_action == "count" ? [1] : []
          content {}
        }
      }

      statement {
        managed_rule_group_statement {
          vendor_name = rule.value.vendor_name
          name        = rule.value.name

          # Note: excluded_rules and scope_down_statement features are available
          # but require specific AWS provider version compatibility
          # For now, use rule_action_override to effectively "exclude" rules by setting them to count
          # Example:
          # rule_action_override {
          #   name = "SizeRestrictions_BODY"
          #   action_to_use {
          #     count {}
          #   }
          # }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.site_label}-${var.ruleset_name}-${rule.value.name}"
        sampled_requests_enabled   = var.log_mode == "realtime"
      }
    }
  }

  # Custom Rules - commented out until statement block structure is fully defined
  # When adding custom rules, ensure the statement block matches AWS WAF v2 syntax
  # Example: rate_based_statement, geo_match_statement, ip_set_reference_statement, etc.
  #
  # dynamic "rule" {
  #   for_each = var.custom_rules
  #   content {
  #     name     = rule.value.name
  #     priority = rule.value.priority
  #
  #     action {
  #       dynamic "allow" {
  #         for_each = rule.value.action == "allow" ? [1] : []
  #         content {}
  #       }
  #       dynamic "block" {
  #         for_each = rule.value.action == "block" ? [1] : []
  #         content {}
  #       }
  #       dynamic "count" {
  #         for_each = rule.value.action == "count" ? [1] : []
  #         content {}
  #       }
  #     }
  #
  #     statement {
  #       # Statement structure must be properly defined
  #     }
  #
  #     visibility_config {
  #       cloudwatch_metrics_enabled = lookup(rule.value.visibility_config, "cloudwatch_metrics_enabled", true)
  #       metric_name                = "${var.site_label}-${var.ruleset_name}-${rule.value.name}"
  #       sampled_requests_enabled   = lookup(rule.value.visibility_config, "sampled_requests_enabled", var.log_mode == "realtime")
  #     }
  #   }
  # }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.site_label}-${var.ruleset_name}-webacl"
    sampled_requests_enabled   = var.log_mode == "realtime"
  }

  tags = {
    Name     = "${var.site_label}-${var.ruleset_name}"
    Site     = var.site_label
    RuleSet  = var.ruleset_name
    LogMode  = var.log_mode
  }
}
