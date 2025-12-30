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

      custom_rules           = []
      custom_response_bodies = {}
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
        },
        {
          name            = "AWSManagedRulesSQLiRuleSet"
          vendor_name     = "AWS"
          priority        = 2
          override_action = "none"
        }
      ]

      custom_rules           = []
      custom_response_bodies = {}
    }

    # =========================================================================
    # AUTH SERVICE - Aggressive WebACL
    # =========================================================================
    # This ruleset uses a "deny by default" approach - only explicitly allowed
    # paths are permitted. All other requests are blocked with a custom response.
    # =========================================================================
    auth = {
      enabled = true

      managed_rules = [
        ## NOTE: Because we have a 'deny all' default rule, the only benefit is potentially failing sooner.
        ##.      There are also rules that prevent .* files etc which interfere w/ .next and _next deployments.
        ##.
        # {
        #   name            = "AWSManagedRulesBotControlRuleSet"
        #   vendor_name     = "AWS"
        #   priority        = 2
        #   override_action = "none"
        # },
        # {
        #   name            = "AWSManagedRulesAmazonIpReputationList"
        #   vendor_name     = "AWS"
        #   priority        = 3
        #   override_action = "none"
        # },
        # {
        #   name            = "AWSManagedRulesAnonymousIpList"
        #   vendor_name     = "AWS"
        #   priority        = 4
        #   override_action = "none"
        # },
        # {
        #   name            = "AWSManagedRulesCommonRuleSet"
        #   vendor_name     = "AWS"
        #   priority        = 5
        #   override_action = "none"
        # },
        # {
        #   name            = "AWSManagedRulesKnownBadInputsRuleSet"
        #   vendor_name     = "AWS"
        #   priority        = 6
        #   override_action = "none"
        # },
        # {
        #   name            = "AWSManagedRulesSQLiRuleSet"
        #   vendor_name     = "AWS"
        #   priority        = 7
        #   override_action = "none"
        # }
      ]

      custom_rules = [
        # ALLOW: All OIDC endpoints (priority 0 to run BEFORE managed rules)
        # OIDC endpoints are blocked by AWS managed rules:
        # - .well-known paths trigger hidden file/directory patterns
        # - POST /token with auth params triggers SQLi/bad input rules
        # Must allow all /api/oidc/ paths before managed rules block them
        # Supports optional region prefix: /api/oidc/, /use1/api/oidc/, /cac1/api/oidc/
        {
          name            = "AllowOidcEndpoints"
          priority        = 0
          action          = "allow"
          custom_response = null
          statement = {
            rate_based_statement = null
            byte_match_statement = null
            regex_match_statement = {
              regex_string         = "^(/(use1|cac1))?/api/oidc/"
              field_to_match       = { uri_path = {}, method = null }
              text_transformations = [{ priority = 0, type = "LOWERCASE" }]
            }
          }
        },
        # ALLOW: Regional S3 assets (priority 1 to run BEFORE managed rules)
        # This prevents managed rules from blocking Next.js static assets
        {
          name            = "AllowRegionalAssetsEarly"
          priority        = 1
          action          = "allow"
          custom_response = null
          statement = {
            rate_based_statement = null
            byte_match_statement = null
            regex_match_statement = {
              regex_string         = "^/(use1|cac1)/assets/"
              field_to_match       = { uri_path = {}, method = null }
              text_transformations = [{ priority = 0, type = "LOWERCASE" }]
            }
          }
        },

        # Block POST /api/login without altcha proof-of-work in body
        # This prevents bots from hitting the login endpoint without solving the challenge
        # Supports optional region prefix: /api/login, /use1/api/login, /cac1/api/login
        {
          name     = "RequireAltchaOnLogin"
          priority = 9
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement  = null
            byte_match_statement  = null
            regex_match_statement = null
            and_statement = {
              statements = [
                {
                  byte_match_statement = {
                    search_string         = "POST"
                    positional_constraint = "EXACTLY"
                    field_to_match        = { method = {} }
                    text_transformations  = [{ priority = 0, type = "NONE" }]
                  }
                },
                {
                  regex_match_statement = {
                    regex_string         = "^(/(use1|cac1))?/api/login$"
                    field_to_match       = { uri_path = {} }
                    text_transformations = [{ priority = 0, type = "LOWERCASE" }]
                  }
                },
                {
                  not_statement = {
                    statement = {
                      regex_match_statement = {
                        regex_string         = "\"altcha\"\\s*:\\s*\"[^\"]+\""
                        field_to_match       = { body = {} }
                        text_transformations = [{ priority = 0, type = "NONE" }]
                      }
                    }
                  }
                }
              ]
            }
          }
        },

        # Rate Limiting: POST /api/login - Prevents brute-force
        # Supports optional region prefix: /api/login, /use1/api/login, /cac1/api/login
        {
          name     = "RateLimitLoginEndpoint"
          priority = 10
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement = {
              limit              = 150
              aggregate_key_type = "IP"
              scope_down_statement = {
                and_statement = {
                  statements = [
                    {
                      regex_match_statement = {
                        regex_string         = "^(/(use1|cac1))?/api/login"
                        field_to_match       = { uri_path = {}, method = null }
                        text_transformations = [{ priority = 0, type = "LOWERCASE" }]
                      }
                    },
                    {
                      byte_match_statement = {
                        search_string         = "POST"
                        positional_constraint = "EXACTLY"
                        field_to_match        = { uri_path = null, method = {} }
                        text_transformations  = [{ priority = 0, type = "NONE" }]
                      }
                    }
                  ]
                }
                byte_match_statement  = null
                regex_match_statement = null
              }
            }
            byte_match_statement  = null
            regex_match_statement = null
          }
        },
        # Rate Limiting: GET /api/captcha/challenge - Prevents challenge generation abuse
        # Supports optional region prefix
        {
          name     = "RateLimitCaptchaChallenge"
          priority = 11
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement = {
              limit              = 150
              aggregate_key_type = "IP"
              scope_down_statement = {
                and_statement = {
                  statements = [
                    {
                      regex_match_statement = {
                        regex_string         = "^(/(use1|cac1))?/api/captcha/challenge$"
                        field_to_match       = { uri_path = {}, method = null }
                        text_transformations = [{ priority = 0, type = "LOWERCASE" }]
                      }
                    },
                    {
                      byte_match_statement = {
                        search_string         = "GET"
                        positional_constraint = "EXACTLY"
                        field_to_match        = { uri_path = null, method = {} }
                        text_transformations  = [{ priority = 0, type = "NONE" }]
                      }
                    }
                  ]
                }
                byte_match_statement  = null
                regex_match_statement = null
              }
            }
            byte_match_statement  = null
            regex_match_statement = null
          }
        },
        # Rate Limiting: /api/session/validate - OPTIONS requests
        # Supports optional region prefix
        {
          name     = "RateLimitSessionValidateOptions"
          priority = 12
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement = {
              limit              = 150
              aggregate_key_type = "IP"
              scope_down_statement = {
                and_statement = {
                  statements = [
                    {
                      regex_match_statement = {
                        regex_string         = "^(/(use1|cac1))?/api/session/validate"
                        field_to_match       = { uri_path = {}, method = null }
                        text_transformations = [{ priority = 0, type = "LOWERCASE" }]
                      }
                    },
                    {
                      byte_match_statement = {
                        search_string         = "OPTIONS"
                        positional_constraint = "EXACTLY"
                        field_to_match        = { uri_path = null, method = {} }
                        text_transformations  = [{ priority = 0, type = "NONE" }]
                      }
                    }
                  ]
                }
                byte_match_statement  = null
                regex_match_statement = null
              }
            }
            byte_match_statement  = null
            regex_match_statement = null
          }
        },
        # Rate Limiting: /api/session/validate - GET requests with sess_auth cookie
        # Supports optional region prefix
        {
          name     = "RateLimitSessionValidateGet"
          priority = 13
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement = {
              limit              = 150
              aggregate_key_type = "IP"
              scope_down_statement = {
                and_statement = {
                  statements = [
                    {
                      regex_match_statement = {
                        regex_string         = "^(/(use1|cac1))?/api/session/validate"
                        field_to_match       = { uri_path = {}, method = null }
                        text_transformations = [{ priority = 0, type = "LOWERCASE" }]
                      }
                    },
                    {
                      byte_match_statement = {
                        search_string         = "GET"
                        positional_constraint = "EXACTLY"
                        field_to_match        = { uri_path = null, method = {} }
                        text_transformations  = [{ priority = 0, type = "NONE" }]
                      }
                    },
                    {
                      byte_match_statement = {
                        search_string         = "sess_auth"
                        positional_constraint = "CONTAINS"
                        field_to_match        = { uri_path = null, method = null, single_header = { name = "cookie" } }
                        text_transformations  = [{ priority = 0, type = "NONE" }]
                      }
                    }
                  ]
                }
                byte_match_statement  = null
                regex_match_statement = null
              }
            }
            byte_match_statement  = null
            regex_match_statement = null
          }
        },
        # Rate Limiting: /api/auth/*
        # Supports optional region prefix
        {
          name     = "RateLimitAuthEndpoints"
          priority = 14
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement = {
              limit              = 150
              aggregate_key_type = "IP"
              scope_down_statement = {
                and_statement        = null
                byte_match_statement = null
                regex_match_statement = {
                  regex_string         = "^(/(use1|cac1))?/api/auth/"
                  field_to_match       = { uri_path = {}, method = null }
                  text_transformations = [{ priority = 0, type = "LOWERCASE" }]
                }
              }
            }
            byte_match_statement  = null
            regex_match_statement = null
          }
        },
        # Rate Limiting: /api/oidc/*
        # Supports optional region prefix
        {
          name     = "RateLimitOidcEndpoints"
          priority = 15
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement = {
              limit              = 150
              aggregate_key_type = "IP"
              scope_down_statement = {
                and_statement        = null
                byte_match_statement = null
                regex_match_statement = {
                  regex_string         = "^(/(use1|cac1))?/api/oidc/"
                  field_to_match       = { uri_path = {}, method = null }
                  text_transformations = [{ priority = 0, type = "LOWERCASE" }]
                }
              }
            }
            byte_match_statement  = null
            regex_match_statement = null
          }
        },
        # Global Rate Limit (200 req/5min)
        {
          name     = "RateLimitGlobal"
          priority = 16
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement = {
              limit                = 200
              aggregate_key_type   = "IP"
              scope_down_statement = null
            }
            byte_match_statement  = null
            regex_match_statement = null
          }
        },
        # ALLOW: /api/* paths
        # Supports optional region prefix
        {
          name            = "AllowApiPaths"
          priority        = 50
          action          = "allow"
          custom_response = null
          statement = {
            rate_based_statement = null
            byte_match_statement = null
            regex_match_statement = {
              regex_string         = "^(/(use1|cac1))?/api/"
              field_to_match       = { uri_path = {}, method = null }
              text_transformations = [{ priority = 0, type = "LOWERCASE" }]
            }
          }
        },
        # ALLOW: /login and /strava pages
        # Supports optional region prefix
        {
          name            = "AllowLoginPages"
          priority        = 51
          action          = "allow"
          custom_response = null
          statement = {
            rate_based_statement = null
            byte_match_statement = null
            regex_match_statement = {
              regex_string         = "^(/(use1|cac1))?/(login|strava)"
              field_to_match       = { uri_path = {}, method = null }
              text_transformations = [{ priority = 0, type = "LOWERCASE" }]
            }
          }
        },
        # ALLOW: Root path / or /{region}/
        # Supports optional region prefix
        {
          name            = "AllowRootPath"
          priority        = 52
          action          = "allow"
          custom_response = null
          statement = {
            rate_based_statement = null
            byte_match_statement = null
            regex_match_statement = {
              regex_string         = "^(/(use1|cac1))?/?$"
              field_to_match       = { uri_path = {}, method = null }
              text_transformations = [{ priority = 0, type = "NONE" }]
            }
          }
        },
        # ALLOW: Health check /hello (nginx health check - no region prefix)
        {
          name            = "AllowHealthCheck"
          priority        = 53
          action          = "allow"
          custom_response = null
          statement = {
            rate_based_statement  = null
            regex_match_statement = null
            byte_match_statement = {
              search_string         = "/hello"
              positional_constraint = "EXACTLY"
              field_to_match        = { uri_path = {}, method = null }
              text_transformations  = [{ priority = 0, type = "LOWERCASE" }]
            }
          }
        },
        # ALLOW: Favicon
        # Supports optional region prefix
        {
          name            = "AllowFavicon"
          priority        = 55
          action          = "allow"
          custom_response = null
          statement = {
            rate_based_statement = null
            byte_match_statement = null
            regex_match_statement = {
              regex_string         = "^(/(use1|cac1))?/favicon"
              field_to_match       = { uri_path = {}, method = null }
              text_transformations = [{ priority = 0, type = "LOWERCASE" }]
            }
          }
        },
        {
          name     = "DefaultDenyAll"
          priority = 100
          action   = "block"
          custom_response = {
            response_code            = 469
            custom_response_body_key = "auth-blocked"
          }
          statement = {
            rate_based_statement  = null
            regex_match_statement = null
            byte_match_statement = {
              search_string         = "/"
              positional_constraint = "STARTS_WITH"
              field_to_match        = { uri_path = {}, method = null }
              text_transformations  = [{ priority = 0, type = "NONE" }]
            }
          }
        }
      ]

      custom_response_bodies = {
        "auth-blocked" = {
          content_type = "APPLICATION_JSON"
          content      = "{\"error\":\"Blocked\",\"message\":\"This endpoint is not available or unauthorized.\",\"code\":\"BLOCKED\"}"
        }
      }
    }
  }
}
