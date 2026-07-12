# qr-resolver module (v1.0.0)

Terraform for the `q.defcon.run` QR / short-link resolver service — Phases 2–4
of `docs/superpowers/specs/2026-07-11-qr-service-design.md`.

**Status: authored for review, NOT wired to a live unit, NOT applied.** There is
no `infra/terraform/live/site/.../qr-resolver/terragrunt.hcl` yet, so CI's
plan/apply workflows do not touch this. Deploy is a deliberate follow-up.

## What it creates

| Resource | Purpose |
|----------|---------|
| `aws_lambda_function.resolver` | Stateless resolver — parse path, `GetItem` a `qr` code from `run-human-electro`, apply time/param/enrich rules, `302`, emit one structured JSON log line. Read-only on data; never validates CTF answers. |
| `aws_lambda_function.rollup` | Analytics rollup — cron/flush → Logs Insights over the resolver log group → upsert `qrstat`. |
| `aws_cloudwatch_event_rule.rollup_cron` | Drives the rollup (default `rate(30 minutes)`). |
| `aws_cloudwatch_log_group.{resolver,rollup}` | Dedicated log groups; the resolver group is the rollup's source. |
| IAM roles/policies | Least-privilege: resolver = logs + `dynamodb:GetItem` (read-only); rollup = Logs Insights + `qrstat` writes (+ optional flush-token SSM read). |

## PENDING DECISION 1 — reachability (why `enable_transport` defaults to false)

The public ALB accepts 443 **only** from the CloudFront prefix list, so
`q.defcon.run` cannot be reached direct-to-ALB (memory `reference_alb_cloudfront_only`;
same constraint that moved Phase 1 `r./h./sao.` to CloudFront functions).

`transport.tf` authors the **ALB → Lambda target group + host listener rule**
behind `var.enable_transport` (default **false**). The CloudFront distro for
`q.` (cache disabled, Host forwarded, origin = ALB) is **not** authored yet —
it should reuse `modules/cloudfront-redirect` conventions once Decision 1 = A is
confirmed. **Do not set `enable_transport = true` until that distro exists**, or
`q.` will resolve to an unreachable ALB.

If Decision 1 = B (Lambda@Edge / CloudFront Function) is chosen instead, the
resolver core lib is transport-agnostic — only `index.mjs`'s event adapter and
this file change.

## PENDING DECISION 2 — region-awareness

There is no per-user region cookie (region is a build-time `REGION_SHORT`/basePath
value). The resolver defaults run.human destinations to `/use1` behind a
`resolveRegion()` seam (`lib/respond.mjs`). Upgrading to a per-code `region`
field is a one-function change. See the spec-corrections doc.

## Wiring it later (follow-up)

1. Confirm Decisions 1 & 2.
2. Author the `q.` CloudFront distro (reuse `cloudfront-redirect`).
3. Add a live unit `live/site/region/us-east-1/qr-resolver/terragrunt.hcl` that
   runs `npm ci --omit=dev` in both `apps/run.qr/lambda/{resolver,rollup}` and
   points `resolver_source_path` / `rollup_source_path` at them (see `config.hcl`).
4. Pass `electro_table_arn`, `alb_listener_arn`, and (optionally) `flush_token_ssm_arn`.
5. `terragrunt plan` → review → apply. Then Route53 `q.` alias → the CloudFront distro.
