# AWS WAF Web ACL for CloudFront (must be created in us-east-1)
resource "aws_wafv2_web_acl" "this" {
  count       = var.enabled ? 1 : 0
  name        = "${var.site_label}-${var.ruleset_name}"
  description = "WAF Web ACL ${var.ruleset_name} for ${var.site_label}"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Custom response bodies for blocked requests
  dynamic "custom_response_body" {
    for_each = var.custom_response_bodies
    content {
      key          = custom_response_body.key
      content      = custom_response_body.value.content
      content_type = custom_response_body.value.content_type
    }
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
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.site_label}-${var.ruleset_name}-${rule.value.name}"
        sampled_requests_enabled   = true # Free - always enable for debugging
      }
    }
  }

  # Custom Rules
  dynamic "rule" {
    for_each = var.custom_rules
    content {
      name     = rule.value.name
      priority = rule.value.priority

      action {
        dynamic "allow" {
          for_each = rule.value.action == "allow" ? [1] : []
          content {}
        }
        dynamic "block" {
          for_each = rule.value.action == "block" ? [1] : []
          content {
            dynamic "custom_response" {
              for_each = try(rule.value.custom_response, null) != null ? [rule.value.custom_response] : []
              content {
                response_code            = custom_response.value.response_code
                custom_response_body_key = try(custom_response.value.custom_response_body_key, null)

                dynamic "response_header" {
                  for_each = try(custom_response.value.response_headers, [])
                  content {
                    name  = response_header.value.name
                    value = response_header.value.value
                  }
                }
              }
            }
          }
        }
        dynamic "count" {
          for_each = rule.value.action == "count" ? [1] : []
          content {}
        }
      }

      # Dynamic statement handling for various WAF rule types
      statement {
        # Rate-based statement
        dynamic "rate_based_statement" {
          for_each = try(rule.value.statement.rate_based_statement, null) != null ? [rule.value.statement.rate_based_statement] : []
          content {
            limit              = rate_based_statement.value.limit
            aggregate_key_type = rate_based_statement.value.aggregate_key_type

            # Scope down statement for rate limiting specific paths
            dynamic "scope_down_statement" {
              for_each = try(rate_based_statement.value.scope_down_statement, null) != null ? [rate_based_statement.value.scope_down_statement] : []
              content {
                # Byte match for scope down
                dynamic "byte_match_statement" {
                  for_each = try(scope_down_statement.value.byte_match_statement, null) != null ? [scope_down_statement.value.byte_match_statement] : []
                  content {
                    search_string         = byte_match_statement.value.search_string
                    positional_constraint = byte_match_statement.value.positional_constraint
                    field_to_match {
                      dynamic "uri_path" {
                        for_each = try(byte_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                        content {}
                      }
                      dynamic "method" {
                        for_each = try(byte_match_statement.value.field_to_match.method, null) != null ? [1] : []
                        content {}
                      }
                    }
                    dynamic "text_transformation" {
                      for_each = byte_match_statement.value.text_transformations
                      content {
                        priority = text_transformation.value.priority
                        type     = text_transformation.value.type
                      }
                    }
                  }
                }

                # Regex match for scope down (for pattern matching paths)
                dynamic "regex_match_statement" {
                  for_each = try(scope_down_statement.value.regex_match_statement, null) != null ? [scope_down_statement.value.regex_match_statement] : []
                  content {
                    regex_string = regex_match_statement.value.regex_string
                    field_to_match {
                      dynamic "uri_path" {
                        for_each = try(regex_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                        content {}
                      }
                      dynamic "method" {
                        for_each = try(regex_match_statement.value.field_to_match.method, null) != null ? [1] : []
                        content {}
                      }
                    }
                    dynamic "text_transformation" {
                      for_each = regex_match_statement.value.text_transformations
                      content {
                        priority = text_transformation.value.priority
                        type     = text_transformation.value.type
                      }
                    }
                  }
                }

                # AND statement for scope down (e.g., path AND method)
                dynamic "and_statement" {
                  for_each = try(scope_down_statement.value.and_statement, null) != null ? [scope_down_statement.value.and_statement] : []
                  content {
                    dynamic "statement" {
                      for_each = and_statement.value.statements
                      content {
                        dynamic "byte_match_statement" {
                          for_each = try(statement.value.byte_match_statement, null) != null ? [statement.value.byte_match_statement] : []
                          content {
                            search_string         = byte_match_statement.value.search_string
                            positional_constraint = byte_match_statement.value.positional_constraint
                            field_to_match {
                              dynamic "uri_path" {
                                for_each = try(byte_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                                content {}
                              }
                              dynamic "method" {
                                for_each = try(byte_match_statement.value.field_to_match.method, null) != null ? [1] : []
                                content {}
                              }
                              dynamic "single_header" {
                                for_each = try(byte_match_statement.value.field_to_match.single_header, null) != null ? [byte_match_statement.value.field_to_match.single_header] : []
                                content {
                                  name = single_header.value.name
                                }
                              }
                            }
                            dynamic "text_transformation" {
                              for_each = byte_match_statement.value.text_transformations
                              content {
                                priority = text_transformation.value.priority
                                type     = text_transformation.value.type
                              }
                            }
                          }
                        }

                        # Regex match within and_statement inside scope_down_statement
                        dynamic "regex_match_statement" {
                          for_each = try(statement.value.regex_match_statement, null) != null ? [statement.value.regex_match_statement] : []
                          content {
                            regex_string = regex_match_statement.value.regex_string
                            field_to_match {
                              dynamic "uri_path" {
                                for_each = try(regex_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                                content {}
                              }
                              dynamic "method" {
                                for_each = try(regex_match_statement.value.field_to_match.method, null) != null ? [1] : []
                                content {}
                              }
                            }
                            dynamic "text_transformation" {
                              for_each = regex_match_statement.value.text_transformations
                              content {
                                priority = text_transformation.value.priority
                                type     = text_transformation.value.type
                              }
                            }
                          }
                        }

                      }
                    }
                  }
                }
              }
            }
          }
        }

        # Byte match statement (for path allowlisting)
        dynamic "byte_match_statement" {
          for_each = try(rule.value.statement.byte_match_statement, null) != null ? [rule.value.statement.byte_match_statement] : []
          content {
            search_string         = byte_match_statement.value.search_string
            positional_constraint = byte_match_statement.value.positional_constraint
            field_to_match {
              dynamic "uri_path" {
                for_each = try(byte_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                content {}
              }
              dynamic "method" {
                for_each = try(byte_match_statement.value.field_to_match.method, null) != null ? [1] : []
                content {}
              }
              dynamic "query_string" {
                for_each = try(byte_match_statement.value.field_to_match.query_string, null) != null ? [1] : []
                content {}
              }
            }
            dynamic "text_transformation" {
              for_each = byte_match_statement.value.text_transformations
              content {
                priority = text_transformation.value.priority
                type     = text_transformation.value.type
              }
            }
          }
        }

        # Regex match statement (for pattern matching)
        dynamic "regex_match_statement" {
          for_each = try(rule.value.statement.regex_match_statement, null) != null ? [rule.value.statement.regex_match_statement] : []
          content {
            regex_string = regex_match_statement.value.regex_string
            field_to_match {
              dynamic "uri_path" {
                for_each = try(regex_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                content {}
              }
              dynamic "method" {
                for_each = try(regex_match_statement.value.field_to_match.method, null) != null ? [1] : []
                content {}
              }
            }
            dynamic "text_transformation" {
              for_each = regex_match_statement.value.text_transformations
              content {
                priority = text_transformation.value.priority
                type     = text_transformation.value.type
              }
            }
          }
        }

        # Geo match statement (for country blocking)
        dynamic "geo_match_statement" {
          for_each = try(rule.value.statement.geo_match_statement, null) != null ? [rule.value.statement.geo_match_statement] : []
          content {
            country_codes = geo_match_statement.value.country_codes
          }
        }

        # IP set reference statement
        dynamic "ip_set_reference_statement" {
          for_each = try(rule.value.statement.ip_set_reference_statement, null) != null ? [rule.value.statement.ip_set_reference_statement] : []
          content {
            arn = ip_set_reference_statement.value.arn
          }
        }

        # NOT statement (for negation at top level)
        # Used for "block if header NOT present" type rules (e.g., origin verification)
        dynamic "not_statement" {
          for_each = try(rule.value.statement.not_statement, null) != null ? [rule.value.statement.not_statement] : []
          content {
            statement {
              # Byte match inside not_statement
              dynamic "byte_match_statement" {
                for_each = try(not_statement.value.statement.byte_match_statement, null) != null ? [not_statement.value.statement.byte_match_statement] : []
                content {
                  search_string         = byte_match_statement.value.search_string
                  positional_constraint = byte_match_statement.value.positional_constraint
                  field_to_match {
                    dynamic "uri_path" {
                      for_each = try(byte_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                      content {}
                    }
                    dynamic "method" {
                      for_each = try(byte_match_statement.value.field_to_match.method, null) != null ? [1] : []
                      content {}
                    }
                    dynamic "single_header" {
                      for_each = try(byte_match_statement.value.field_to_match.single_header, null) != null ? [byte_match_statement.value.field_to_match.single_header] : []
                      content {
                        name = single_header.value.name
                      }
                    }
                  }
                  dynamic "text_transformation" {
                    for_each = byte_match_statement.value.text_transformations
                    content {
                      priority = text_transformation.value.priority
                      type     = text_transformation.value.type
                    }
                  }
                }
              }

              # Regex match inside not_statement
              dynamic "regex_match_statement" {
                for_each = try(not_statement.value.statement.regex_match_statement, null) != null ? [not_statement.value.statement.regex_match_statement] : []
                content {
                  regex_string = regex_match_statement.value.regex_string
                  field_to_match {
                    dynamic "uri_path" {
                      for_each = try(regex_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                      content {}
                    }
                    dynamic "method" {
                      for_each = try(regex_match_statement.value.field_to_match.method, null) != null ? [1] : []
                      content {}
                    }
                    dynamic "single_header" {
                      for_each = try(regex_match_statement.value.field_to_match.single_header, null) != null ? [regex_match_statement.value.field_to_match.single_header] : []
                      content {
                        name = single_header.value.name
                      }
                    }
                  }
                  dynamic "text_transformation" {
                    for_each = regex_match_statement.value.text_transformations
                    content {
                      priority = text_transformation.value.priority
                      type     = text_transformation.value.type
                    }
                  }
                }
              }
            }
          }
        }

        # AND statement (for combining multiple conditions at top level)
        dynamic "and_statement" {
          for_each = try(rule.value.statement.and_statement, null) != null ? [rule.value.statement.and_statement] : []
          content {
            dynamic "statement" {
              for_each = and_statement.value.statements
              content {
                # Byte match within and_statement
                dynamic "byte_match_statement" {
                  for_each = try(statement.value.byte_match_statement, null) != null ? [statement.value.byte_match_statement] : []
                  content {
                    search_string         = byte_match_statement.value.search_string
                    positional_constraint = byte_match_statement.value.positional_constraint
                    field_to_match {
                      dynamic "uri_path" {
                        for_each = try(byte_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                        content {}
                      }
                      dynamic "method" {
                        for_each = try(byte_match_statement.value.field_to_match.method, null) != null ? [1] : []
                        content {}
                      }
                      dynamic "body" {
                        for_each = try(byte_match_statement.value.field_to_match.body, null) != null ? [1] : []
                        content {}
                      }
                      dynamic "single_header" {
                        for_each = try(byte_match_statement.value.field_to_match.single_header, null) != null ? [byte_match_statement.value.field_to_match.single_header] : []
                        content {
                          name = single_header.value.name
                        }
                      }
                    }
                    dynamic "text_transformation" {
                      for_each = byte_match_statement.value.text_transformations
                      content {
                        priority = text_transformation.value.priority
                        type     = text_transformation.value.type
                      }
                    }
                  }
                }

                # Regex match within and_statement
                dynamic "regex_match_statement" {
                  for_each = try(statement.value.regex_match_statement, null) != null ? [statement.value.regex_match_statement] : []
                  content {
                    regex_string = regex_match_statement.value.regex_string
                    field_to_match {
                      dynamic "uri_path" {
                        for_each = try(regex_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                        content {}
                      }
                      dynamic "method" {
                        for_each = try(regex_match_statement.value.field_to_match.method, null) != null ? [1] : []
                        content {}
                      }
                      dynamic "body" {
                        for_each = try(regex_match_statement.value.field_to_match.body, null) != null ? [1] : []
                        content {}
                      }
                      dynamic "single_header" {
                        for_each = try(regex_match_statement.value.field_to_match.single_header, null) != null ? [regex_match_statement.value.field_to_match.single_header] : []
                        content {
                          name = single_header.value.name
                        }
                      }
                    }
                    dynamic "text_transformation" {
                      for_each = regex_match_statement.value.text_transformations
                      content {
                        priority = text_transformation.value.priority
                        type     = text_transformation.value.type
                      }
                    }
                  }
                }

                # NOT statement within and_statement (for negation)
                dynamic "not_statement" {
                  for_each = try(statement.value.not_statement, null) != null ? [statement.value.not_statement] : []
                  content {
                    statement {
                      # Byte match inside not_statement
                      dynamic "byte_match_statement" {
                        for_each = try(not_statement.value.statement.byte_match_statement, null) != null ? [not_statement.value.statement.byte_match_statement] : []
                        content {
                          search_string         = byte_match_statement.value.search_string
                          positional_constraint = byte_match_statement.value.positional_constraint
                          field_to_match {
                            dynamic "uri_path" {
                              for_each = try(byte_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                              content {}
                            }
                            dynamic "method" {
                              for_each = try(byte_match_statement.value.field_to_match.method, null) != null ? [1] : []
                              content {}
                            }
                            dynamic "body" {
                              for_each = try(byte_match_statement.value.field_to_match.body, null) != null ? [1] : []
                              content {}
                            }
                            dynamic "single_header" {
                              for_each = try(byte_match_statement.value.field_to_match.single_header, null) != null ? [byte_match_statement.value.field_to_match.single_header] : []
                              content {
                                name = single_header.value.name
                              }
                            }
                          }
                          dynamic "text_transformation" {
                            for_each = byte_match_statement.value.text_transformations
                            content {
                              priority = text_transformation.value.priority
                              type     = text_transformation.value.type
                            }
                          }
                        }
                      }

                      # Regex match inside not_statement
                      dynamic "regex_match_statement" {
                        for_each = try(not_statement.value.statement.regex_match_statement, null) != null ? [not_statement.value.statement.regex_match_statement] : []
                        content {
                          regex_string = regex_match_statement.value.regex_string
                          field_to_match {
                            dynamic "uri_path" {
                              for_each = try(regex_match_statement.value.field_to_match.uri_path, null) != null ? [1] : []
                              content {}
                            }
                            dynamic "method" {
                              for_each = try(regex_match_statement.value.field_to_match.method, null) != null ? [1] : []
                              content {}
                            }
                            dynamic "body" {
                              for_each = try(regex_match_statement.value.field_to_match.body, null) != null ? [1] : []
                              content {}
                            }
                            dynamic "single_header" {
                              for_each = try(regex_match_statement.value.field_to_match.single_header, null) != null ? [regex_match_statement.value.field_to_match.single_header] : []
                              content {
                                name = single_header.value.name
                              }
                            }
                          }
                          dynamic "text_transformation" {
                            for_each = regex_match_statement.value.text_transformations
                            content {
                              priority = text_transformation.value.priority
                              type     = text_transformation.value.type
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = try(rule.value.visibility_config.cloudwatch_metrics_enabled, true)
        metric_name                = "${var.site_label}-${var.ruleset_name}-${rule.value.name}"
        sampled_requests_enabled   = true # Free - always enable for debugging
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.site_label}-${var.ruleset_name}-webacl"
    sampled_requests_enabled   = true # Free - always enable for debugging
  }

  tags = {
    Name     = "${var.site_label}-${var.ruleset_name}"
    Site     = var.site_label
    RuleSet  = var.ruleset_name
    LogMode  = var.log_mode
  }
}
