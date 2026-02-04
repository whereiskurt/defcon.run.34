# =============================================================================
# CloudTrail Module
# Records all AWS API calls for IAM role activity analysis and policy generation
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id  = data.aws_caller_identity.current.account_id
  region      = data.aws_region.current.id
  trail_name  = "${var.site.label}-cloudtrail"
  bucket_name = "${var.site.label}-cloudtrail-logs-${var.site.random_suffix}"

  # List of role ARNs to monitor (for Athena queries)
  github_role_arns = [
    for role_name in var.cloudtrail.monitor_roles :
    "arn:aws:iam::${local.account_id}:role/${var.site.label}-github-${role_name}"
  ]
}

# =============================================================================
# S3 Bucket for CloudTrail Logs
# =============================================================================

resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket        = local.bucket_name
  force_destroy = true  # Allow deletion even with objects/versions

  tags = {
    Name      = local.bucket_name
    Site      = var.site.label
    Purpose   = "cloudtrail-logs"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_s3_bucket_versioning" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    expiration {
      days = var.cloudtrail.log_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "transition-to-glacier"
    status = var.cloudtrail.glacier_transition_days > 0 ? "Enabled" : "Disabled"

    transition {
      days          = var.cloudtrail.glacier_transition_days
      storage_class = "GLACIER"
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudTrail bucket policy - allow CloudTrail to write logs
resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSCloudTrailAclCheck"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:GetBucketAcl"
        Resource = aws_s3_bucket.cloudtrail_logs.arn
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = "arn:aws:cloudtrail:${local.region}:${local.account_id}:trail/${local.trail_name}"
          }
        }
      },
      {
        Sid    = "AWSCloudTrailWrite"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.cloudtrail_logs.arn}/AWSLogs/${local.account_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl"  = "bucket-owner-full-control"
            "AWS:SourceArn" = "arn:aws:cloudtrail:${local.region}:${local.account_id}:trail/${local.trail_name}"
          }
        }
      }
    ]
  })
}

# =============================================================================
# CloudTrail Trail
# =============================================================================

resource "aws_cloudtrail" "main" {
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = true
  is_multi_region_trail         = var.cloudtrail.multi_region
  enable_logging                = true

  # KMS encryption for logs
  kms_key_id = var.cloudtrail.enable_kms_encryption ? aws_kms_key.cloudtrail[0].arn : null

  # Enable log file validation for integrity checking
  enable_log_file_validation = true

  # Management events (API calls like CreateRole, AssumeRole, etc.)
  event_selector {
    read_write_type           = "All"
    include_management_events = true
  }

  depends_on = [aws_s3_bucket_policy.cloudtrail_logs]

  tags = {
    Name      = local.trail_name
    Site      = var.site.label
    Purpose   = "iam-activity-logging"
    ManagedBy = "Terragrunt"
  }
}

# =============================================================================
# IAM Access Analyzer
# Analyzes CloudTrail logs to generate least-privilege policies
# =============================================================================

resource "aws_accessanalyzer_analyzer" "main" {
  count = var.cloudtrail.enable_access_analyzer ? 1 : 0

  analyzer_name = "${var.site.label}-access-analyzer"
  type          = "ACCOUNT"

  tags = {
    Name      = "${var.site.label}-access-analyzer"
    Site      = var.site.label
    Purpose   = "policy-generation"
    ManagedBy = "Terragrunt"
  }
}

# =============================================================================
# Athena Resources for Querying CloudTrail Logs
# =============================================================================

resource "aws_s3_bucket" "athena_results" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  bucket        = "${var.site.label}-athena-results-${var.site.random_suffix}"
  force_destroy = true  # Allow deletion even with objects/versions

  tags = {
    Name      = "${var.site.label}-athena-results"
    Site      = var.site.label
    Purpose   = "athena-query-results"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "athena_results" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  bucket = aws_s3_bucket.athena_results[0].id

  rule {
    id     = "expire-query-results"
    status = "Enabled"

    expiration {
      days = 7
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_public_access_block" "athena_results" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  bucket = aws_s3_bucket.athena_results[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_athena_workgroup" "cloudtrail" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  name = "${var.site.label}-cloudtrail-analysis"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results[0].id}/query-results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }

  tags = {
    Name      = "${var.site.label}-cloudtrail-analysis"
    Site      = var.site.label
    Purpose   = "cloudtrail-queries"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_glue_catalog_database" "cloudtrail" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  name = "${replace(var.site.label, "-", "_")}_cloudtrail"

  description = "CloudTrail logs database for ${var.site.label}"
}

resource "aws_glue_catalog_table" "cloudtrail" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  name          = "cloudtrail_logs"
  database_name = aws_glue_catalog_database.cloudtrail[0].name

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "projection.enabled"            = "true"
    "projection.date.type"          = "date"
    "projection.date.format"        = "yyyy/MM/dd"
    "projection.date.range"         = "2024/01/01,NOW"
    "projection.date.interval"      = "1"
    "projection.date.interval.unit" = "DAYS"
    "storage.location.template"     = "s3://${aws_s3_bucket.cloudtrail_logs.id}/AWSLogs/${local.account_id}/CloudTrail/${local.region}/$${date}"
    EXTERNAL                        = "TRUE"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.cloudtrail_logs.id}/AWSLogs/${local.account_id}/CloudTrail/${local.region}/"
    input_format  = "com.amazon.emr.cloudtrail.CloudTrailInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hive.hcatalog.data.JsonSerDe"
    }

    columns {
      name = "eventversion"
      type = "string"
    }
    columns {
      name = "useridentity"
      type = "struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>,webidfederationdata:struct<federatedprovider:string,attributes:map<string,string>>>>"
    }
    columns {
      name = "eventtime"
      type = "string"
    }
    columns {
      name = "eventsource"
      type = "string"
    }
    columns {
      name = "eventname"
      type = "string"
    }
    columns {
      name = "awsregion"
      type = "string"
    }
    columns {
      name = "sourceipaddress"
      type = "string"
    }
    columns {
      name = "useragent"
      type = "string"
    }
    columns {
      name = "errorcode"
      type = "string"
    }
    columns {
      name = "errormessage"
      type = "string"
    }
    columns {
      name = "requestparameters"
      type = "string"
    }
    columns {
      name = "responseelements"
      type = "string"
    }
    columns {
      name = "additionaleventdata"
      type = "string"
    }
    columns {
      name = "requestid"
      type = "string"
    }
    columns {
      name = "eventid"
      type = "string"
    }
    columns {
      name = "eventtype"
      type = "string"
    }
    columns {
      name = "apiversion"
      type = "string"
    }
    columns {
      name = "readonly"
      type = "string"
    }
    columns {
      name = "recipientaccountid"
      type = "string"
    }
    columns {
      name = "serviceeventdetails"
      type = "string"
    }
    columns {
      name = "sharedeventid"
      type = "string"
    }
    columns {
      name = "vpcendpointid"
      type = "string"
    }
    columns {
      name = "tlsdetails"
      type = "struct<tlsversion:string,ciphersuite:string,clientprovidedhostheader:string>"
    }
  }

  partition_keys {
    name = "date"
    type = "string"
  }
}

# =============================================================================
# SSM Parameters for Query Templates
# Store useful Athena queries for analyzing role activity
# These are non-sensitive SQL query templates - encryption not required
# =============================================================================

#checkov:skip=CKV2_AWS_34:Athena query templates are non-sensitive SQL
resource "aws_ssm_parameter" "athena_query_role_activity" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  name        = "/${var.site.label}/cloudtrail/queries/role-activity"
  description = "Athena query to list all actions by a specific role"
  type        = "String"

  value = <<-EOT
-- Actions by specific role (replace ROLE_NAME with actual role)
-- Example: <site_label>-github-terragrunt, <site_label>-github-application, etc.
SELECT
    eventtime,
    eventsource,
    eventname,
    useridentity.arn as role_arn,
    awsregion,
    sourceipaddress,
    errorcode,
    errormessage
FROM ${aws_glue_catalog_database.cloudtrail[0].name}.cloudtrail_logs
WHERE useridentity.arn LIKE '%ROLE_NAME%'
    AND date >= date_format(current_date - interval '30' day, '%Y/%m/%d')
ORDER BY eventtime DESC
LIMIT 1000;
EOT

  tags = {
    Site      = var.site.label
    Purpose   = "athena-query-template"
    ManagedBy = "Terragrunt"
  }
}

#checkov:skip=CKV2_AWS_34:Athena query templates are non-sensitive SQL
resource "aws_ssm_parameter" "athena_query_unique_actions" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  name        = "/${var.site.label}/cloudtrail/queries/unique-actions-by-role"
  description = "Athena query to get unique actions per role for policy generation"
  type        = "String"

  value = <<-EOT
-- Unique actions by role for policy generation
-- Run this after 30 days of activity to identify actual permissions needed
SELECT
    useridentity.sessioncontext.sessionissuer.arn as role_arn,
    eventsource,
    eventname,
    COUNT(*) as call_count,
    COUNT(DISTINCT awsregion) as regions_used,
    MIN(eventtime) as first_seen,
    MAX(eventtime) as last_seen
FROM ${aws_glue_catalog_database.cloudtrail[0].name}.cloudtrail_logs
WHERE useridentity.type = 'AssumedRole'
    AND useridentity.sessioncontext.sessionissuer.arn LIKE 'arn:aws:iam::%:role/${var.site.label}-github-%'
    AND date >= date_format(current_date - interval '30' day, '%Y/%m/%d')
    AND errorcode IS NULL  -- Only successful calls
GROUP BY
    useridentity.sessioncontext.sessionissuer.arn,
    eventsource,
    eventname
ORDER BY role_arn, eventsource, eventname;
EOT

  tags = {
    Site      = var.site.label
    Purpose   = "athena-query-template"
    ManagedBy = "Terragrunt"
  }
}

#checkov:skip=CKV2_AWS_34:Athena query templates are non-sensitive SQL
resource "aws_ssm_parameter" "athena_query_denied_actions" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  name        = "/${var.site.label}/cloudtrail/queries/denied-actions"
  description = "Athena query to find permission denied errors"
  type        = "String"

  value = <<-EOT
-- Find permission denied errors - useful for identifying missing permissions
SELECT
    eventtime,
    useridentity.arn as role_arn,
    eventsource,
    eventname,
    errorcode,
    errormessage,
    requestparameters
FROM ${aws_glue_catalog_database.cloudtrail[0].name}.cloudtrail_logs
WHERE errorcode IN ('AccessDenied', 'UnauthorizedAccess', 'Client.UnauthorizedOperation')
    AND useridentity.arn LIKE '%${var.site.label}-github-%'
    AND date >= date_format(current_date - interval '7' day, '%Y/%m/%d')
ORDER BY eventtime DESC
LIMIT 500;
EOT

  tags = {
    Site      = var.site.label
    Purpose   = "athena-query-template"
    ManagedBy = "Terragrunt"
  }
}

#checkov:skip=CKV2_AWS_34:Athena query templates are non-sensitive SQL
resource "aws_ssm_parameter" "athena_query_github_summary" {
  count = var.cloudtrail.enable_athena ? 1 : 0

  name        = "/${var.site.label}/cloudtrail/queries/github-roles-summary"
  description = "Athena query summarizing GitHub OIDC role activity"
  type        = "String"

  value = <<-EOT
-- Summary of GitHub OIDC role activity
SELECT
    useridentity.sessioncontext.sessionissuer.arn as role_arn,
    COUNT(*) as total_api_calls,
    COUNT(DISTINCT eventsource) as unique_services,
    COUNT(DISTINCT eventname) as unique_actions,
    COUNT(CASE WHEN errorcode IS NOT NULL THEN 1 END) as error_count,
    MIN(eventtime) as first_activity,
    MAX(eventtime) as last_activity
FROM ${aws_glue_catalog_database.cloudtrail[0].name}.cloudtrail_logs
WHERE useridentity.type = 'AssumedRole'
    AND useridentity.sessioncontext.sessionissuer.arn LIKE 'arn:aws:iam::%:role/${var.site.label}-github-%'
    AND date >= date_format(current_date - interval '30' day, '%Y/%m/%d')
GROUP BY useridentity.sessioncontext.sessionissuer.arn
ORDER BY total_api_calls DESC;
EOT

  tags = {
    Site      = var.site.label
    Purpose   = "athena-query-template"
    ManagedBy = "Terragrunt"
  }
}
