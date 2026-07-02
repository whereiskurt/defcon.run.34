# S3-only SES receive rules. Independent of forwarding.tf's fwd_rules chain —
# no Lambda invocation, just writes raw MIME to received_emails at a prefix.

locals {
  receive_rules_map = {
    for rule in var.receive_rules :
    rule.name => rule
  }
}

resource "aws_ses_receipt_rule" "receive" {
  for_each      = local.receive_rules_map
  name          = each.value.name
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = [each.value.match]
  enabled       = true
  scan_enabled  = true
  tls_policy    = "Optional"

  s3_action {
    bucket_name       = aws_s3_bucket.received_emails.id
    object_key_prefix = each.value.object_key_prefix
    position          = 1
  }

  depends_on = [
    aws_s3_bucket_policy.received_emails
  ]

  lifecycle {
    create_before_destroy = true
  }
}
