# =============================================================================
# sns.tf — standalone abuse-detection alert topic + email subscription.
#
# Checkpoint-directed deviation from the plan's "reuse the Phase 40 topic":
# admin-reports (the Phase 40 topic owner) is gated off behind the un-validated
# 40-07 /ecs/* retention import, so enabling it just to borrow the topic would
# pull in that risk. Instead abuse-detection owns a dedicated tripwire topic —
# the email path stays live with zero coupling to admin-reports.
#
# The whole unit ships dark via the terragrunt exclude gate, so this topic +
# subscription only exist when abuse_detection.enabled = true.
# =============================================================================

resource "aws_sns_topic" "abuse" {
  name = var.sns_topic_name
  tags = var.tags
}

# Email subscription. AWS sends a one-time confirmation link to var.alert_email;
# the operator must click it before alerts deliver (SNS shows "PendingConfirmation"
# until then). No alert is lost by leaving it pending — findings still land in S3.
resource "aws_sns_topic_subscription" "abuse_email" {
  topic_arn = aws_sns_topic.abuse.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
