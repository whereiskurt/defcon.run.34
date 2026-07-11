terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

locals {
  tags = {
    site    = "dc34"
    service = "run-bib"
    region  = "use1"
  }
}

data "aws_kms_alias" "ssm" {
  name = "alias/dc34-ssm-use1"
}

# --- SecureString: placeholder value, real value set out-of-band via AWS CLI ---

resource "aws_ssm_parameter" "stripe_secret_key" {
  name   = "/dc34/secrets/use1/bib/stripe/secret_key"
  type   = "SecureString"
  key_id = data.aws_kms_alias.ssm.target_key_id
  value  = "PLACEHOLDER_SET_BY_KURT"
  tags   = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_webhook_signing_secret" {
  name   = "/dc34/secrets/use1/bib/stripe/webhook_signing_secret"
  type   = "SecureString"
  key_id = data.aws_kms_alias.ssm.target_key_id
  value  = "PLACEHOLDER_SET_BY_KURT"
  tags   = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# --- Live-mode (production) Stripe credentials ---
# Parallel to the test-mode params above. Both sets live in SSM permanently;
# the running container selects which pair to read via the STRIPE_LIVE_MODE
# env toggle (see services/run.bib/service.hcl). Real sk_live_* / whsec_*
# values are set out-of-band via AWS CLI, same as the test-mode params.

resource "aws_ssm_parameter" "stripe_secret_key_live" {
  name   = "/dc34/secrets/use1/bib/stripe/secret_key_live"
  type   = "SecureString"
  key_id = data.aws_kms_alias.ssm.target_key_id
  value  = "PLACEHOLDER_SET_BY_KURT"
  tags   = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_webhook_signing_secret_live" {
  name   = "/dc34/secrets/use1/bib/stripe/webhook_signing_secret_live"
  type   = "SecureString"
  key_id = data.aws_kms_alias.ssm.target_key_id
  value  = "PLACEHOLDER_SET_BY_KURT"
  tags   = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "anthropic_api_key" {
  name   = "/dc34/secrets/use1/bib/anthropic/api_key"
  type   = "SecureString"
  key_id = data.aws_kms_alias.ssm.target_key_id
  value  = "PLACEHOLDER_SET_BY_KURT"
  tags   = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# --- String: real defaults committed here (default IS the operational value) ---

resource "aws_ssm_parameter" "venmo_handle" {
  name  = "/dc34/secrets/use1/bib/venmo/handle"
  type  = "String"
  value = "@defconrun"
  tags  = local.tags
}

resource "aws_ssm_parameter" "cashapp_handle" {
  name  = "/dc34/secrets/use1/bib/cashapp/handle"
  type  = "String"
  value = "$defconrun"
  tags  = local.tags
}
