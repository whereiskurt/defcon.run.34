# WAF Rulesets Configuration
# This file defines multiple WAF Web ACL rulesets that can be attached to CloudFront distributions
# Each ruleset is a separate WAF Web ACL with its own set of rules

locals {
  waf_rulesets = {
    # Default ruleset with comprehensive protection
    default = {
      enabled = true

      managed_rules = [
        {
          name            = "AWSManagedRulesCommonRuleSet"
          vendor_name     = "AWS"
          priority        = 1
          override_action = "none"
        },
        {
          name            = "AWSManagedRulesKnownBadInputsRuleSet"
          vendor_name     = "AWS"
          priority        = 2
          override_action = "none"
        },
        {
          name            = "AWSManagedRulesSQLiRuleSet"
          vendor_name     = "AWS"
          priority        = 3
          override_action = "none"
        },
        {
          name            = "AWSManagedRulesAmazonIpReputationList"
          vendor_name     = "AWS"
          priority        = 4
          override_action = "none"
        },
        {
          name            = "AWSManagedRulesAnonymousIpList"
          vendor_name     = "AWS"
          priority        = 5
          override_action = "none"
        }
      ]

      custom_rules = []
    }

    # Lightweight ruleset for APIs (fewer restrictions)
    api = {
      enabled = true

      managed_rules = [
        {
          name            = "AWSManagedRulesCommonRuleSet"
          vendor_name     = "AWS"
          priority        = 1
          override_action = "none"
          # Note: To exclude specific rules, use rule_action_override in the module
          # or set override_action = "count" for testing
        },
        {
          name            = "AWSManagedRulesSQLiRuleSet"
          vendor_name     = "AWS"
          priority        = 2
          override_action = "none"
        }
      ]

      custom_rules = []
    }

    # Example: Custom ruleset with rate limiting
    # rate-limited = {
    #   enabled = true
    #
    #   managed_rules = [
    #     {
    #       name            = "AWSManagedRulesCommonRuleSet"
    #       vendor_name     = "AWS"
    #       priority        = 1
    #       override_action = "none"
    #       excluded_rules  = []
    #     }
    #   ]
    #
    #   custom_rules = [
    #     {
    #       name     = "RateLimitRule"
    #       priority = 100
    #       action   = "block"
    #
    #       # Note: The statement block structure depends on your specific needs
    #       # This is a placeholder showing the structure
    #       statement = {
    #         rate_based_statement = {
    #           limit              = 2000
    #           aggregate_key_type = "IP"
    #         }
    #       }
    #
    #       visibility_config = {
    #         cloudwatch_metrics_enabled = true
    #         sampled_requests_enabled   = true
    #       }
    #     }
    #   ]
    # }
  }
}
