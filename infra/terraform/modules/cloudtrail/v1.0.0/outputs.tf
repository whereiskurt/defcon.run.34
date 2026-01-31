output "trail_arn" {
  description = "ARN of the CloudTrail trail"
  value       = aws_cloudtrail.main.arn
}

output "trail_name" {
  description = "Name of the CloudTrail trail"
  value       = aws_cloudtrail.main.name
}

output "logs_bucket_name" {
  description = "Name of the S3 bucket storing CloudTrail logs"
  value       = aws_s3_bucket.cloudtrail_logs.id
}

output "logs_bucket_arn" {
  description = "ARN of the S3 bucket storing CloudTrail logs"
  value       = aws_s3_bucket.cloudtrail_logs.arn
}

output "access_analyzer_arn" {
  description = "ARN of the IAM Access Analyzer"
  value       = var.cloudtrail.enable_access_analyzer ? aws_accessanalyzer_analyzer.main[0].arn : null
}

output "athena_workgroup" {
  description = "Name of the Athena workgroup for CloudTrail queries"
  value       = var.cloudtrail.enable_athena ? aws_athena_workgroup.cloudtrail[0].name : null
}

output "athena_database" {
  description = "Name of the Glue database for CloudTrail logs"
  value       = var.cloudtrail.enable_athena ? aws_glue_catalog_database.cloudtrail[0].name : null
}

output "athena_table" {
  description = "Name of the Glue table for CloudTrail logs"
  value       = var.cloudtrail.enable_athena ? aws_glue_catalog_table.cloudtrail[0].name : null
}

output "athena_results_bucket" {
  description = "S3 bucket for Athena query results"
  value       = var.cloudtrail.enable_athena ? aws_s3_bucket.athena_results[0].id : null
}

output "query_ssm_parameters" {
  description = "SSM parameter names containing Athena query templates"
  value = var.cloudtrail.enable_athena ? {
    role_activity    = aws_ssm_parameter.athena_query_role_activity[0].name
    unique_actions   = aws_ssm_parameter.athena_query_unique_actions[0].name
    denied_actions   = aws_ssm_parameter.athena_query_denied_actions[0].name
    github_summary   = aws_ssm_parameter.athena_query_github_summary[0].name
  } : null
}

output "monitor_role_arns" {
  description = "ARNs of the GitHub OIDC roles being monitored"
  value       = local.github_role_arns
}

# Usage instructions
output "usage_instructions" {
  description = "How to use CloudTrail and Access Analyzer for policy generation"
  value       = <<-EOT
## CloudTrail + IAM Access Analyzer Usage

### 1. Wait for Activity (30+ days recommended)
   Let your GitHub Actions workflows run for at least 30 days to capture
   all typical API call patterns.

### 2. Generate Least-Privilege Policies with Access Analyzer
   In AWS Console:
   - Go to IAM → Access Analyzer → Policy generation
   - Select the role (e.g., ${var.site.label}-github-terragrunt)
   - Choose CloudTrail trail: ${local.trail_name}
   - Set date range (last 30-90 days)
   - Click "Generate policy"

   Or via CLI:
   aws accessanalyzer start-policy-generation \
     --policy-generation-details '{
       "principalArn": "arn:aws:iam::${local.account_id}:role/${var.site.label}-github-terragrunt"
     }' \
     --cloud-trail-details '{
       "trails": [{"cloudTrailArn": "${aws_cloudtrail.main.arn}", "allRegions": true}],
       "startTime": "$(date -d '30 days ago' -Iseconds)",
       "endTime": "$(date -Iseconds)"
     }'

### 3. Query CloudTrail with Athena
   ${var.cloudtrail.enable_athena ? "Athena workgroup: ${aws_athena_workgroup.cloudtrail[0].name}" : "Athena not enabled"}

   Sample queries stored in SSM:
   - ${var.cloudtrail.enable_athena ? aws_ssm_parameter.athena_query_github_summary[0].name : "N/A"}

   Run queries in AWS Console → Athena, or:
   aws athena start-query-execution \
     --query-string "$(aws ssm get-parameter --name '/${var.site.label}/cloudtrail/queries/github-roles-summary' --query 'Parameter.Value' --output text)" \
     --work-group ${var.cloudtrail.enable_athena ? aws_athena_workgroup.cloudtrail[0].name : "N/A"}

### 4. Review and Replace Policies
   After generating least-privilege policies:
   - Review generated policies for completeness
   - Test in a staging environment first
   - Update site.hcl with scoped-down policies
   - Deploy with terragrunt apply
EOT
}
