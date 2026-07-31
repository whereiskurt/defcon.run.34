# heatmap-scheduler live unit (Phase 71, Plan 07) — the clock for the DC34
# heat-map artifact. us-east-1 ONLY: run.gpx is single-live-region today, and a
# second scheduler in ca-central-1 would cron-invoke a service that does not
# exist there and fail forever.
#
# sync_url points at run.gpx's AWS Cloud Map / ECS service-discovery private
# DNS name (the SAME pattern service.hcl uses for AUTH_INTERNAL_URL /
# CMS_INTERNAL_URL / RUN_HUMAN_INTERNAL_URL — see
# infra/terraform/live/site/services/run.gpx/service.hcl:100-102). That
# namespace is a VPC-private Route 53 hosted zone: it does NOT resolve outside
# the VPC. The public ALB is CloudFront-only (it accepts 443 ONLY from the
# CloudFront prefix list per reference_alb_cloudfront_only), so hitting it
# directly from a Lambda would either fail DNS resolution (private zone) or
# time out (if some public name were used instead) — neither the public
# gpx.<domain> host NOR a bare no-VPC Lambda can reach the internal route.
# So this unit attaches the Lambda to the VPC (private subnets + the same
# self-referencing `http_only` security group run-gpx's ECS tasks use, which
# already ingresses port 3000 from members of itself — see the network
# module's securitygroups.tf).
#
# internal_sync_secret_ssm_path/arn point at the SAME SSM parameter that backs
# run.gpx's AUTH_INTERNAL_SECRET env var (service.hcl:192-193), because the
# gpx internal routes accept INTERNAL_SYNC_SECRET ?? AUTH_INTERNAL_SECRET.
#
# HEADER LANDMINE (mirrors strava-sync-scheduler / bib-reconcile / qr-resolver):
# this unit MUST live under region/us-east-1/ so
# modules/heatmap-scheduler/config.hcl's find_in_parent_folders("region.hcl")
# resolves region.{label,full}.
#
# VALIDATION: scoped `terragrunt plan` (needs creds), or the terragrunt-plan.yml
# GH Action with region=us-east-1, modules=heatmap-scheduler. NEVER apply from a
# workstation (AGENTS.md rule 4) — the apply is terragrunt-apply.yml with the
# same scoping, in Plan 71-08.
#
# VALIDATED: actions/runs/30601617385 (terragrunt-plan.yml, region=us-east-1,
# modules=heatmap-scheduler) — "Plan: 9 to add, 0 to change, 0 to destroy",
# zero strava-sync addresses, no scheduler: authorization error.

include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}

locals {
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  site_label   = local.site_vars.locals.site.label
  region_label = local.region_vars.locals.region.label
  region_full  = local.region_vars.locals.region.full

  # SSM path of the shared jwt/internal_secret parameter — the SAME parameter
  # run.gpx's AUTH_INTERNAL_SECRET reads (service.hcl:193), resolved the same
  # way secrets.ssm_prefix does ("/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}").
  internal_secret_ssm_path = "/${local.site_label}/secrets/${local.region_label}/jwt/internal_secret"

  # run.gpx's Cloud Map / ECS service-discovery private DNS name — mirrors
  # AUTH_INTERNAL_URL's shape in services/run.gpx/service.hcl:100-102
  # ("http://run-auth.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:3000/{{REGION_LABEL}}"),
  # applied to gpx itself; the heat-map build route path is appended below.
  gpx_internal_origin = "http://run-gpx.app-${local.region_label}-${local.site_label}.local:3000"
}

# Skip when the region is in site.skip_regions (mirrors bib-reconcile).
exclude {
  if      = include.skip.locals.should_skip
  actions = ["all"]
}

include "module" {
  path   = "${find_in_parent_folders("modules")}/heatmap-scheduler/config.hcl"
  expose = true
}

include "providers" {
  path = "${find_in_parent_folders("providers")}/regional.hcl"
}

terraform {
  source = "${include.module.locals.module_path}/v1.0.0"

  # index.mjs has no npm dependencies (only the AWS SDK v3, present in the
  # Lambda runtime) — no before_hook needed, unlike bib-reconcile/qr-resolver.
}

# Private subnets + the self-referencing security group run-gpx's ECS tasks
# use (network module's http_only SG already ingresses ports 80/8080/3000/1337
# from members of itself — securitygroups.tf). Attaching the Lambda's ENIs to
# the SAME SG lets it reach the run-gpx task on port 3000 without opening any
# new ingress rule.
dependency "network" {
  config_path = "../network"

  mock_outputs = {
    private_subnet_ids = ["subnet-private1", "subnet-private2"]
    security_groups = {
      sshhttps  = "sg-mocksshhttps"
      http_only = "sg-mockhttponly"
      postgres  = "sg-mockpostgres"
      etherpad  = "sg-mocketherpad"
      nlb       = "sg-mocknlb"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = merge(include.module.locals.merged_inputs, {
  sync_url                      = "${local.gpx_internal_origin}/${local.region_label}/api/gpx/internal/heatmap-build"
  internal_sync_secret_ssm_path = local.internal_secret_ssm_path
  internal_sync_secret_ssm_arn  = "arn:aws:ssm:${local.region_full}:${get_aws_account_id()}:parameter${local.internal_secret_ssm_path}"

  vpc_subnet_ids = dependency.network.outputs.private_subnet_ids
  vpc_security_group_ids = [
    dependency.network.outputs.security_groups.http_only, # ingress: membership → gpx:3000 self-rule
    dependency.network.outputs.security_groups.sshhttps,  # egress: allow-all (same as ECS tasks)
  ]

  schedules = {
    # Top of every hour across the DC34 run window — 5-10 August 2026, the
    # dates in CON_DAYS (apps/run.gpx/webapp/src/lib/con-days.ts). This is the
    # cadence behind "submitting a new run changes the artifact within ~an hour".
    hourly = "cron(0 * 5-10 8 ? 2026)"
    # Daily baseline at 04:20 PT, year-round. Without it the artifact would be
    # stale (or missing) for everyone testing before the con and everyone
    # browsing after it, and the layer would look broken outside a six-day window.
    #
    # COLLISION LANDMINE — the minute is 20, NOT 0, and that is load-bearing.
    # The hourly entry above fires at minute 0 of EVERY hour across the six con
    # days, both entries are evaluated in the SAME timezone
    # (schedule_expression_timezone below), so a daily at minute 0 coincides
    # with an hourly on every one of 5-10 August 2026. EventBridge Scheduler
    # then invokes the Lambda TWICE in the same minute, and there is no lock in
    # the builder, no idempotency key and no reserved concurrency on the
    # function — so two full DynamoDB scans and two full S3 fan-outs run
    # concurrently and both write the same artifact key. Minute 20 is
    # deliberately off BOTH the top of the hour and the half hour, so a future
    # half-hourly cadence cannot reintroduce the collision either. Probe
    # assertions 13 (the exact expressions) and 18 (the minute fields must
    # differ) pin this — do not "tidy" it back to :00 or :30.
    daily = "cron(20 4 * * ? *)"
  }
  schedule_expression_timezone = "America/Los_Angeles"
  schedule_enabled             = true

  # TIMEOUT CHAIN — three bounds, STRICTLY increasing, never equal:
  #
  #   240 s  the builder aborts its own work (BUILD_BUDGET_MS = 240_000 in
  #          apps/run.gpx/webapp/src/lib/heatmap-build.ts, added by plan 71-11).
  #          This is the innermost bound and the ONLY one the build itself
  #          enforces — it aborts WITHOUT publishing rather than shrinking the
  #          artifact.
  #   300 s  the invoker Lambda bounds its own fetch (AbortSignal.timeout in
  #          modules/heatmap-scheduler/v1.0.0/lambda/index.mjs), so it OBSERVES
  #          the builder's failure and reports one honest error instead of being
  #          killed while still waiting for a response.
  #   420 s  this value — the Lambda's own budget, which must additionally
  #          absorb the SSM GetParameter round trip, cold start, DNS and
  #          connection setup on top of the 300 s fetch.
  #
  # The previous value was 300, set EQUAL to a route-level Next.js duration
  # export. That export was inert: run.gpx builds with output: "standalone" and
  # runs on ECS Fargate, where the standalone Node server does not enforce it,
  # so the contract this number was written against was fictional AND equal is
  # not enough anyway. Equal (or shorter) kills the invoker mid-flight, the
  # invoker throws, and retry_policy { maximum_retry_attempts = 2 } fires up to
  # two more invocations — each starting a fresh full rebuild while the first is
  # still scanning. If any of the three numbers moves, move it in all three
  # places and keep them strictly increasing.
  lambda_timeout = 420
})
