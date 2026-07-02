locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))
  email_vars  = read_terragrunt_config("email.hcl")

  module_path = "${find_in_parent_folders("modules/")}/email"

  # Merge smtp_iam_users from site and region levels
  merged_smtp_iam_users = concat(
    try(local.site_vars.locals.email.smtp_iam_users, []),
    try(local.email_vars.locals.smtp_iam_users, [])
  )

  # Merge fwd_rules from site and region levels
  merged_fwd_rules = concat(
    try(local.site_vars.locals.email.fwd_rules, []),
    try(local.email_vars.locals.fwd_rules, [])
  )

  # S3-only receive rules come from region-level email.hcl only (they attach
  # to a specific region's bucket, so a site-level list wouldn't make sense).
  receive_rules = try(local.email_vars.locals.receive_rules, [])

  merged_inputs = merge(
    local.site_vars.locals,
    local.region_vars.locals,
    local.email_vars.locals,
    {
      smtp_iam_users               = local.merged_smtp_iam_users
      fwd_rules                    = local.merged_fwd_rules
      receive_rules                = local.receive_rules
      forwarder_lambda_source_path = try(local.email_vars.locals.forwarder_lambda_source_path, "")
    }
  )
}