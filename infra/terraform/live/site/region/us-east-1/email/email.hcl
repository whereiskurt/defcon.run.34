locals {
  # Read parent configuration files to access site and region values
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  # Extract values for easier reference
  dns_zonename = local.site_vars.locals.dns.zonename
  region_label = local.region_vars.locals.region.label

  smtp_iam_users = [
    "${local.region_label}.${local.dns_zonename}"
  ]

  fwd_rules = [
    {
      match   = "${local.region_label}.${local.dns_zonename}"
      send_to = "whereiskurt+${local.region_label}.${local.dns_zonename}@gmail.com"
    },
  ]

  # Path to email forwarder Lambda source code
  forwarder_lambda_source_path = "${get_repo_root()}/infra/terraform/live/site/region/us-east-1/email/lambdas/email-forwarder"
}