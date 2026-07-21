# Phase 23 PLAN-CHECK

**Verdict:** PASSED
**Level:** goal-backward check against ROADMAP.md Phase 23 SCs, adjusted for Kurt's 2026-07-02 rescope.

## Coverage

| SC | Owning task |
|---|---|
| SC1 build.sh / deploy.sh accept run.bib | ALREADY DONE (#230) — noted in CONTEXT, not re-planned |
| SC2 buildpub.yml / deploy.yml include run.bib | ALREADY DONE (#230) — noted in CONTEXT, not re-planned |
| SC3 bib.defcon.run/use1/ serves; health 200 | 23-01-02 (CloudFront + ECS up) + 23-02-01→03 (images pushed + ECS running) + 23-04-01 (smoke) |
| SC4 run.auth redeployed with bib OIDC live | 23-03-01 + 23-03-02 |
| SC5 bib-reconcile-lambda deployed + SES trigger armed | 23-01-03 + 23-04-03 |
| SC6 All SSM params populated + audited | 23-01-04 (audit) |
| SC7 User-facing E2E | Blocker routed to STATE (HITL for Kurt) |
| SC8 Real receipt SES E2E | Blocker routed to STATE (HITL for Kurt) |

No orphan tasks. No unmapped SCs.

## Concerns

**None blocking.** Non-blocking notes:

1. **Terragrunt apply requires AWS creds in sandbox.** Kurt is setting up. If SSO fails when 23-01 fires, executor must halt cleanly + ping Kurt, not synthesize the apply.

2. **Stripe test event signature crafting (23-04-02).** Two paths — Stripe CLI (needs container) or hand-signed via `openssl`. Both are documented; executor picks whichever works. If Stripe CLI is not available, hand-signed is fine — the webhook signature verification is well-specified.

3. **Lambda smoke (23-04-03).** `INTEGRATION=1` flip = burning ~$0.001 of Anthropic budget per invoke. Acceptable smoke cost. If Kurt doesn't want any real Haiku spend, skip 23-04-03 real invoke; the module-load smoke from Plan 22-04 was sufficient.

4. **`terragrunt plan --all` at site level (23-01-01)** may take 5-10 min because it walks every unit. Consider targeted `plan` on just bib-affected units if time-boxed. Executor decides.

5. **CloudFront + ACM cert propagation (23-01-02)** can take 5-15 min after apply. Executor should sleep + re-check, not fail immediately if 23-04-01 curl 404s on first try.

## Sequencing verification

- 23-02 depends on 23-01-01, 23-01-02 (ECR repos exist)
- 23-03 depends on nothing new (run.auth code change already in main)
- 23-03 CAN run in parallel with 23-02 (touches different app)
- 23-04 depends on 23-01, 23-02, 23-03 all complete

Recommended execution:
1. 23-01 serially (plan → apply is inherently serial)
2. 23-02 and 23-03 in parallel (different apps, different ECR repos, different ECS services)
3. 23-04 serially last

## Risk register

| Risk | Mitigation |
|---|---|
| Terragrunt plan surfaces destroys | HALT + Kurt review; never apply |
| ECR push 403 (IAM) | Bug in Phase 20 IAM; hotfix PR |
| ECS task startup failure | CloudWatch logs → app hotfix PR |
| ALB target group unhealthy | Health check path mismatch → nginx.conf or route check |
| CloudFront 502 | Origin ALB issue; wait for ECS convergence |
| Webhook 4xx on test event | Middleware whitelist bug (already fixed) OR signature crypto bug |
| Lambda IAM insufficient | Phase 22-03 IAM tightening bug; module hotfix |

All risks have concrete mitigations. None warrant re-planning.

## Approved for execute-phase.
