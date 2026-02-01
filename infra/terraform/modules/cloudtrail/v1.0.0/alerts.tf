# =============================================================================
# CloudTrail Alerts via SNS + EventBridge
# Sends email alerts for security and cost-related events
# =============================================================================

# SNS Topic for CloudTrail alerts
resource "aws_sns_topic" "cloudtrail_alerts" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  name              = "${var.site.label}-cloudtrail-alerts"
  kms_master_key_id = var.cloudtrail.enable_kms_encryption ? aws_kms_key.cloudtrail[0].arn : null

  tags = {
    Name      = "${var.site.label}-cloudtrail-alerts"
    Site      = var.site.label
    Purpose   = "security-alerts"
    ManagedBy = "Terragrunt"
  }
}

# SNS Topic policy to allow EventBridge to publish
resource "aws_sns_topic_policy" "cloudtrail_alerts" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  arn = aws_sns_topic.cloudtrail_alerts[0].arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowEventBridgePublish"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.cloudtrail_alerts[0].arn
      }
    ]
  })
}

# Email subscription for alerts
resource "aws_sns_topic_subscription" "email" {
  count = var.cloudtrail.enable_alerts && var.cloudtrail.alert_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.cloudtrail_alerts[0].arn
  protocol  = "email"
  endpoint  = var.cloudtrail.alert_email
}

# =============================================================================
# EventBridge Rules for Security Events
# =============================================================================

# Rule: Root account usage
resource "aws_cloudwatch_event_rule" "root_login" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  name        = "${var.site.label}-root-account-usage"
  description = "Alert on root account activity"

  event_pattern = jsonencode({
    source      = ["aws.signin"]
    detail-type = ["AWS Console Sign In via CloudTrail"]
    detail = {
      userIdentity = {
        type = ["Root"]
      }
    }
  })

  tags = {
    Name      = "${var.site.label}-root-account-usage"
    Site      = var.site.label
    AlertType = "security"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_cloudwatch_event_target" "root_login" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  rule      = aws_cloudwatch_event_rule.root_login[0].name
  target_id = "send-to-sns"
  arn       = aws_sns_topic.cloudtrail_alerts[0].arn

  input_transformer {
    input_paths = {
      time      = "$.time"
      region    = "$.region"
      account   = "$.account"
      eventName = "$.detail.eventName"
      sourceIP  = "$.detail.sourceIPAddress"
    }
    input_template = "\"[SECURITY ALERT] Root account activity detected in account <account> at <time>. Event: <eventName> from IP: <sourceIP>\""
  }
}

# Rule: IAM policy changes
resource "aws_cloudwatch_event_rule" "iam_changes" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  name        = "${var.site.label}-iam-changes"
  description = "Alert on IAM policy and role changes"

  event_pattern = jsonencode({
    source      = ["aws.iam"]
    detail-type = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["iam.amazonaws.com"]
      eventName = [
        "CreateUser",
        "DeleteUser",
        "CreateRole",
        "DeleteRole",
        "AttachUserPolicy",
        "DetachUserPolicy",
        "AttachRolePolicy",
        "DetachRolePolicy",
        "PutUserPolicy",
        "DeleteUserPolicy",
        "PutRolePolicy",
        "DeleteRolePolicy",
        "CreateAccessKey",
        "DeleteAccessKey",
        "UpdateAssumeRolePolicy"
      ]
    }
  })

  tags = {
    Name      = "${var.site.label}-iam-changes"
    Site      = var.site.label
    AlertType = "security"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_cloudwatch_event_target" "iam_changes" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  rule      = aws_cloudwatch_event_rule.iam_changes[0].name
  target_id = "send-to-sns"
  arn       = aws_sns_topic.cloudtrail_alerts[0].arn

  input_transformer {
    input_paths = {
      time      = "$.time"
      region    = "$.region"
      eventName = "$.detail.eventName"
      userName  = "$.detail.userIdentity.userName"
      principal = "$.detail.userIdentity.arn"
    }
    input_template = "\"[SECURITY ALERT] IAM change: <eventName> by <principal> at <time> in <region>\""
  }
}

# Rule: Security group changes
resource "aws_cloudwatch_event_rule" "security_group_changes" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  name        = "${var.site.label}-security-group-changes"
  description = "Alert on security group modifications"

  event_pattern = jsonencode({
    source      = ["aws.ec2"]
    detail-type = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["ec2.amazonaws.com"]
      eventName = [
        "AuthorizeSecurityGroupIngress",
        "AuthorizeSecurityGroupEgress",
        "RevokeSecurityGroupIngress",
        "RevokeSecurityGroupEgress",
        "CreateSecurityGroup",
        "DeleteSecurityGroup"
      ]
    }
  })

  tags = {
    Name      = "${var.site.label}-security-group-changes"
    Site      = var.site.label
    AlertType = "security"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_cloudwatch_event_target" "security_group_changes" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  rule      = aws_cloudwatch_event_rule.security_group_changes[0].name
  target_id = "send-to-sns"
  arn       = aws_sns_topic.cloudtrail_alerts[0].arn

  input_transformer {
    input_paths = {
      time      = "$.time"
      region    = "$.region"
      eventName = "$.detail.eventName"
      principal = "$.detail.userIdentity.arn"
    }
    input_template = "\"[SECURITY ALERT] Security group change: <eventName> by <principal> at <time> in <region>\""
  }
}

# Rule: Failed authentication attempts
resource "aws_cloudwatch_event_rule" "failed_auth" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  name        = "${var.site.label}-failed-auth"
  description = "Alert on failed authentication attempts"

  event_pattern = jsonencode({
    source      = ["aws.signin"]
    detail-type = ["AWS Console Sign In via CloudTrail"]
    detail = {
      responseElements = {
        ConsoleLogin = ["Failure"]
      }
    }
  })

  tags = {
    Name      = "${var.site.label}-failed-auth"
    Site      = var.site.label
    AlertType = "security"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_cloudwatch_event_target" "failed_auth" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  rule      = aws_cloudwatch_event_rule.failed_auth[0].name
  target_id = "send-to-sns"
  arn       = aws_sns_topic.cloudtrail_alerts[0].arn

  input_transformer {
    input_paths = {
      time     = "$.time"
      sourceIP = "$.detail.sourceIPAddress"
      userName = "$.detail.userIdentity.userName"
    }
    input_template = "\"[SECURITY ALERT] Failed console login attempt for user <userName> from IP <sourceIP> at <time>\""
  }
}

# =============================================================================
# EventBridge Rules for Cost Events
# =============================================================================

# Rule: EC2 instance launches (potential cost impact)
resource "aws_cloudwatch_event_rule" "ec2_launches" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  name        = "${var.site.label}-ec2-launches"
  description = "Alert on EC2 instance launches"

  event_pattern = jsonencode({
    source      = ["aws.ec2"]
    detail-type = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["ec2.amazonaws.com"]
      eventName   = ["RunInstances"]
    }
  })

  tags = {
    Name      = "${var.site.label}-ec2-launches"
    Site      = var.site.label
    AlertType = "cost"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_cloudwatch_event_target" "ec2_launches" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  rule      = aws_cloudwatch_event_rule.ec2_launches[0].name
  target_id = "send-to-sns"
  arn       = aws_sns_topic.cloudtrail_alerts[0].arn

  input_transformer {
    input_paths = {
      time         = "$.time"
      region       = "$.region"
      principal    = "$.detail.userIdentity.arn"
      instanceType = "$.detail.requestParameters.instanceType"
    }
    input_template = "\"[COST ALERT] EC2 instance launched: <instanceType> by <principal> at <time> in <region>\""
  }
}

# Rule: RDS instance creation
resource "aws_cloudwatch_event_rule" "rds_creation" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  name        = "${var.site.label}-rds-creation"
  description = "Alert on RDS instance creation"

  event_pattern = jsonencode({
    source      = ["aws.rds"]
    detail-type = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["rds.amazonaws.com"]
      eventName   = ["CreateDBInstance", "CreateDBCluster"]
    }
  })

  tags = {
    Name      = "${var.site.label}-rds-creation"
    Site      = var.site.label
    AlertType = "cost"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_cloudwatch_event_target" "rds_creation" {
  count = var.cloudtrail.enable_alerts ? 1 : 0

  rule      = aws_cloudwatch_event_rule.rds_creation[0].name
  target_id = "send-to-sns"
  arn       = aws_sns_topic.cloudtrail_alerts[0].arn

  input_transformer {
    input_paths = {
      time      = "$.time"
      region    = "$.region"
      principal = "$.detail.userIdentity.arn"
      eventName = "$.detail.eventName"
    }
    input_template = "\"[COST ALERT] RDS resource created: <eventName> by <principal> at <time> in <region>\""
  }
}
