# Phase 23 Patterns

Maps each Phase 23 task to its closest existing analog. Sources based on `apps/run.gpx/` and `apps/run.flash/` (both deployed successfully to `use1` via the same pipeline).

## Terragrunt plan/apply

**Analog:** `infra/terraform/live/site/services/run.flash/service.hcl` — deployed to `use1` in v1.4. Same shape: `service.hcl` reads `site.hcl` via `read_terragrunt_config`, defines ECS task + service + ALB target group. Plan/apply from that dir.

**Phase 23 target:** `infra/terraform/live/site/services/run.bib/` — same shape, `run.bib` app component. First plan will likely surface pending: bib subdomain CloudFront + ACM cert + ECR repositories + ECS task/service.

**Analog for Lambda unit:** `infra/terraform/live/site/region/us-east-1/{email,s3-uploads-processor}/terragrunt.hcl` — regional Lambda pattern. Phase 22-03 mirrored this for `bib-reconcile-lambda`.

**Phase 23 target:** `infra/terraform/live/site/region/us-east-1/bib-reconcile/terragrunt.hcl` — plan/apply.

## workflow_dispatch buildpub.yml

**Analog:** How run.gpx and run.flash images get built. Example:
```
gh workflow run buildpub.yml \
  --repo whereiskurt/defcon.run.34 \
  --field apps=run.flash \
  --field regions=use1 \
  --field runner=github-hosted \
  --field parallel=true \
  --field create_pr=true
```

Workflow flow:
1. Auto-bump VERSION files
2. Open a PR with the bump
3. Auto-merge (bot has `contents:write`)
4. Build → push to ECR
5. Deploy trigger fires

**Phase 23 target:** Same invocation with `apps=run.bib`, then `apps=run.auth` after.

## run.auth redeploy

**Analog:** run.auth got redeployed with each of its own updates via `workflow_dispatch buildpub.yml apps=run.auth`. Bib OIDC client change from Plan 21-01-05 lands the same way.

## SSM param audit

**Analog:** No existing dedicated audit script; run.flash and run.gpx both source their SSM values via `from-aws.tmpl` at container start. Phase 23 audit = simple `aws ssm get-parameters-by-path --path /dc34/secrets/use1/bib/` invocation, check every expected param exists + type + non-empty.

## Health check

**Analog:** run.flash exposes `/use1/api/health` returning `{status: "ok"}`. run.bib mirrors this via `apps/run.bib/webapp/src/app/api/health/route.ts` (from Plan 21-01).

**Phase 23 target:** `curl -sf https://bib.defcon.run/use1/api/health | jq .status` == `"ok"`.

## Stripe test event trigger

**Analog:** None in the codebase. Use `stripe trigger checkout.session.completed --add checkout_session:metadata.owner_sub=<test_sub>` via Stripe CLI, OR craft a signed test event via API + POST to the live webhook URL.

Neither requires special SDK deps in the sandbox — plain `curl` + `openssl dgst -sha256 -hmac` against the whsec suffices for a signed payload.

## Post-deploy SUMMARY / STATE / ROADMAP writes

**Analog:** Every prior phase (20, 21, 22) landed a SUMMARY.md at close-out and a STATE.md update at the workstream root. Same pattern.

## What is NOT in scope

- **Multi-region:** Only `use1` at launch. `cac1`/`apse1` deferred to v1.6+.
- **New Terragrunt modules:** Phase 20 + Phase 22-03 modules cover everything; Phase 23 is plan+apply only.
- **App code changes:** run.bib code is complete post-Phase-22 (5 plans + fixup + admin gate fix). Any deploy-time bugs discovered = follow-up hotfix PR, not part of Phase 23 scope.
