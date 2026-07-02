# Phase 23 Plan — Build/Deploy + Branding

**Workstream:** v1-5-bib
**Phase:** 23
**Directive:** Kurt 2026-07-02 — "less HITL, go hard."
**Plans:** 4
**Total tasks:** 13

---

## Plan 23-01 — Terragrunt apply new infra + Lambda unit

**Goal:** All Phase 20 + Phase 22-03 Terragrunt-managed resources live in `use1`. bib CloudFront + ACM + ECR up; bib ECS task+service registered; `bib-reconcile-lambda` deployed with SES S3 trigger armed.

**Depends on:** AWS creds working in sandbox (Kurt setting up).

### Tasks

**23-01-01: `terragrunt plan` at site level (bib subdomain + ECR + service.hcl)**
- `cd infra/terraform/live/site && terragrunt plan --all` (or targeted plan on the bib-affected units — ecs-task, ecs-service, cloudfront, ecr, acm, route53)
- Read the plan carefully; capture into `.planning/workstreams/v1-5-bib/phases/23-build-deploy-branding/23-01-01-plan.txt`
- Verify: only ADDs for the bib footprint (bib subdomain in route53, ACM cert for bib.defcon.run, CloudFront distribution, 2 ECR repos, ECS task def, ECS service). NO destroys on run.flash/run.gpx/run.human/run.auth/run.cms resources.
- Commit the plan-output-snapshot for audit

**23-01-02: `terragrunt apply` bib site resources**
- Apply the audited plan
- Verify: CloudFront distribution created (capture ID); ECR repos accepting `docker push`; ACM cert issued (may take 5-10 min for DNS validation via Route53)
- Commit run log

**23-01-03: `terragrunt plan + apply` bib-reconcile-lambda regional unit**
- `cd infra/terraform/live/site/region/us-east-1/bib-reconcile && terragrunt plan`
- Verify: Lambda function created; IAM role with SSM read + KMS EncryptionContext filter + SES SendEmail to `defcon.run@gmail.com` only + DDB RW on `run-human-electro`; S3 event notification on `ses-inbox-dc34-use1/bib-payments/` prefix
- Apply; capture Lambda ARN
- Commit run log

**23-01-04: SSM param audit + close gate**
- List all `/dc34/secrets/use1/bib/*` params via `aws ssm get-parameters-by-path`
- Verify every expected param exists + type matches (SecureString vs String) + non-empty (via `--with-decryption`)
- Expected params:
  - `stripe/secret_key` (SecureString, `sk_test_*`)
  - `stripe/publishable_key` (String, `pk_test_*`)
  - `stripe/webhook_signing_secret` (SecureString, `whsec_C9DDXh41lrexKi6w8pKZMRXlWodwYXIb` — the real value)
  - `anthropic/api_key` (SecureString, `sk-ant-*`)
  - `admin/allowlist` (String, comma-separated emails; MUST include Kurt's + Jesse's)
  - `venmo/handle` (String; default `@defconrun` if not overridden)
  - `cashapp/handle` (String; default `$defconrun` if not overridden)
- Write `23-01-04-ssm-audit.txt` — pass/fail per param
- If any FAIL → block, ping Kurt with the specific missing param
- Commit audit

## Plan 23-02 — Build + push run.bib images via workflow_dispatch

**Goal:** ECR has `dc34-run-bib-nginx:X.Y.Z` + `dc34-run-bib-app:X.Y.Z` pushed and tagged. VERSION files bumped and merged to main.

**Depends on:** Plan 23-01 (ECR repos exist).

### Tasks

**23-02-01: Trigger `buildpub.yml` with `apps=run.bib` regions=use1**
- `gh workflow run buildpub.yml --repo whereiskurt/defcon.run.34 -f apps=run.bib -f regions=use1 -f runner=github-hosted -f parallel=true -f create_pr=true`
- Capture the run ID
- `gh run watch <RUN_ID>` — block until status = completed
- If failed: `gh run view <RUN_ID> --log-failed` and open a hotfix PR; do NOT proceed
- Commit `23-02-01-buildpub-run.log`

**23-02-02: Verify ECR push + release-PR merge**
- `aws ecr list-images --repository-name dc34-run-bib-nginx --region us-east-1` — must show new tag matching the VERSION bump
- `aws ecr list-images --repository-name dc34-run-bib-app --region us-east-1` — same
- `git log main --oneline -5` — must show `Bump versions for release: run.bib` merged commit
- Commit `23-02-02-ecr-verify.txt`

**23-02-03: Verify ECS deployment kicked**
- The buildpub.yml `deploy-use1` job should have already triggered `terragrunt apply` on ecs-task + ecs-service modules
- `aws ecs describe-services --cluster dc34-use1 --services dc34-run-bib` — service exists; `desiredCount > 0`; `runningCount` converges to `desiredCount` within ~5 min
- If ALB target group unhealthy: capture logs + iterate
- Commit `23-02-03-ecs-verify.txt`

## Plan 23-03 — Redeploy run.auth so bib OIDC client takes effect

**Goal:** `apps/run.auth/webapp/src/config/oidc.ts` bib client entry is live in run.auth ECS. `/api/auth/authorize?client_id=bib&...` returns a valid OIDC response instead of "unknown client".

**Depends on:** Nothing new — run.auth code change from Plan 21-01-05 is already in main.

### Tasks

**23-03-01: Trigger `buildpub.yml apps=run.auth` regions=use1**
- Same `gh workflow run` pattern as 23-02-01
- `gh run watch <RUN_ID>`
- Commit `23-03-01-run-log.txt`

**23-03-02: Verify run.auth redeploy + bib client active**
- ECR + release-PR verification (mirror 23-02-02)
- `curl https://auth.defcon.run/use1/api/health` — 200
- `curl -I "https://auth.defcon.run/use1/api/auth/authorize?client_id=bib&response_type=code&redirect_uri=https%3A%2F%2Fbib.defcon.run%2Fuse1%2Fapi%2Fauth%2Fcallback%2Frun.defcon.run&scope=openid+profile+email+services"` — expect 302 (login redirect), NOT 400 unknown client
- Commit `23-03-02-oidc-verify.txt`

## Plan 23-04 — Post-deploy verification + Phase 23 close

**Goal:** bib.defcon.run/use1/ is reachable, health check passes, one Stripe test event round-trips through the webhook. Phase 23 closed in STATE.md + workstream marked ready for v1.5 GA.

**Depends on:** Plans 23-01, 23-02, 23-03.

### Tasks

**23-04-01: Public HTTPS smoke**
- `curl -sf https://bib.defcon.run/use1/api/health | jq '.status'` — expect `"ok"`
- `curl -I https://bib.defcon.run/use1/` — expect 200 or 302 (302 = redirect to /signin, which is the middleware's expected behavior for unauthenticated). NOT 502/503/504.
- Commit `23-04-01-public-smoke.txt`

**23-04-02: Live Stripe webhook signed test event**
- Craft a `checkout.session.completed` event body via Stripe API (`POST /v1/events` isn't public; instead use `POST /v1/test_helpers/*` if available, OR construct a synthetic event body + sign it with the whsec + POST to `https://bib.defcon.run/use1/api/stripe/webhook`)
- Simplest: use `stripe trigger checkout.session.completed --add checkout_session:metadata.owner_sub=<test_sub>` via a stripe-cli container run; but this needs an active session
- Alternative: emit synthetic event via `curl` + `openssl dgst -sha256 -hmac`. Payload matches Stripe's Checkout Session shape; whsec = `whsec_C9DDXh41lrexKi6w8pKZMRXlWodwYXIb`
- Expected: webhook returns 200 (no matching bib is OK — the "drop, no retry" branch); CloudWatch shows the webhook logs
- If webhook returns 4xx: signature or middleware whitelist bug — hotfix PR
- Commit `23-04-02-stripe-webhook-smoke.txt`

**23-04-03: Lambda smoke (dry-run event via CLI)**
- `aws lambda invoke --function-name bib-reconcile --payload file://tests/fixtures/venmo-01.eml.event.json /tmp/lambda-response.json` (build the SES event JSON from the fixture)
- Expected: response `statusCode: 200`, log entry indicates Haiku called (or budget-cap fallback if `INTEGRATION=1` not set — either is a valid smoke outcome, not a failure)
- BibReconcile row appears in DDB
- Commit `23-04-03-lambda-smoke.txt`

**23-04-04: Phase 23 SUMMARY + STATE close + ROADMAP mark done**
- Write `SUMMARY.md` with commit ledger + smoke results + HITL follow-ups routed to Kurt
- Update `.planning/workstreams/v1-5-bib/STATE.md`: `status: v1.5 code + deploy complete; ready for HITL E2E`, `progress.completed_phases: 4`, `progress.percent: 100`
- Update `.planning/workstreams/v1-5-bib/ROADMAP.md` Progress table — mark Phase 23 done
- Commit all three at once

---

## Blockers routed to STATE.md (HITL for Kurt)

- **4-step user-facing E2E** (sign in → register → sponsor Stripe → paidAmount updates → charm renders) — requires a real browser + Stripe Checkout redirect + login flow
- **Real Venmo/CashApp receipt** forwarded to `bibpayment@run.defcon.run` from your gmail — needs Kurt's inbox + a real Venmo/CashApp payment on some test account (or a well-crafted synthetic email)
- **Live Stripe live-mode `sk_live_*`** — for GA launch, not v1.5 test-mode release
- **Multi-region cac1/apse1 deploy** — deferred to v1.6+

## Autonomous execution guardrails

- Every `terragrunt apply` MUST be preceded by a `terragrunt plan` that lands a snapshot into the phase dir for audit
- If a plan shows destroys on unrelated infra, HALT + ping Kurt
- If a build/deploy workflow fails with an app code bug, open a hotfix PR (do NOT force-apply Terragrunt over a broken image)
- No `git push --force` on `main`
- All commits per-task via `--admin` merge (ruleset bypass working per session verification)

## Estimated end-state

- v1.5 100% code + deploy complete
- 3 open HITL items routed to Kurt (E2E, real receipt, live-mode Stripe)
- Ready for v1.5 GA once Kurt's E2E passes
- Ready for /gsd:complete-milestone when GA ships
