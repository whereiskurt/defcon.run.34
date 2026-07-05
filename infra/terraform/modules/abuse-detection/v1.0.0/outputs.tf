# =============================================================================
# abuse-detection module — output contract (Phase 41)
#
# Only outputs whose resources exist after Plan 01 are declared here (Glue
# database + table, Athena workgroup, dual-role results bucket). Lambda/report
# outputs are added by their owning plans as NEW output files (e.g.
# outputs_lambda.tf) to preserve single-file ownership and avoid forward
# references to not-yet-authored resources.
# =============================================================================

output "glue_database_name" {
  description = "Name of the Glue catalog database holding the ALB access-log table."
  value       = aws_glue_catalog_database.abuse.name
}

output "glue_table_name" {
  description = "Name of the Glue external table over the ALB access logs."
  value       = aws_glue_catalog_table.alb_access_logs.name
}

output "athena_workgroup_name" {
  description = "Name of the dedicated Athena workgroup (bytes-scanned cap enforced)."
  value       = aws_athena_workgroup.abuse.name
}

output "results_bucket_name" {
  description = "Name of the dual-role results bucket (Athena query-results/ + findings under abuse/)."
  value       = aws_s3_bucket.results.bucket
}

output "results_bucket_arn" {
  description = "ARN of the dual-role results bucket."
  value       = aws_s3_bucket.results.arn
}
