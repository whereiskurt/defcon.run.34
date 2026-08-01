---
created: 2026-07-31T22:10:00Z
title: "heatmap-scheduler module default lambda_timeout=300 recreates the overlapping-build DoS on any second instantiation"
area: infra/terraform
priority: medium
---

Found by the Phase 71 security audit (`71-SECURITY.md`, residual **R-2**). Non-blocking —
the **live** us-east-1 unit is correct — but the module ships a default that reintroduces the
exact threat Phase 71 closed (`T-71-11-04`).

## The problem

`infra/terraform/modules/heatmap-scheduler/v1.0.0/variables.tf:75` still defaults
`lambda_timeout = 300`. Phase 71 established that the chain must be **strictly increasing**:

```
builder BUILD_BUDGET_MS  240s
  <  invoker fetch AbortSignal  300s
  <  lambda_timeout            420s
```

A default of `300` is **equal** to the invoker's fetch bound. Equal is not enough: the Lambda's
budget must also absorb the SSM round trip, cold start, DNS and connection setup, so a
genuinely slow build has the invoker's fetch and the Lambda's own timeout expiring together.
EventBridge then retries into a rebuild that may already be running — which is
`T-71-11-04` (retries stack concurrent rebuilds) recreated.

The live unit is safe only because
`infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl` explicitly
overrides to `420` (verified live: `Timeout: 420`, `ReservedConcurrentExecutions: 1`). Any
**second** instantiation — a cac1 or apse1 unit, or a copy of the module — that omits the
override silently gets the dangerous value.

## Fix

Change the `lambda_timeout` default in `variables.tf` to `420` and repoint its description,
which currently still describes the bound in terms of a `maxDuration` export that Phase 71
**deleted** (it was inert under `output: "standalone"` on ECS Fargate). The description should
cite `BUILD_BUDGET_MS` in `apps/run.gpx/webapp/src/lib/heatmap-build.ts` instead.

Note this is a module-version-level change: bumping the default is a behaviour change for any
consumer, so decide deliberately whether it warrants `v1.0.1` or an in-place edit given the
module currently has exactly one live consumer.

## Related, same audit

**R-4** — `strava-sync` and `reconcile` internal routes still use a short-circuiting `!==`
secret comparison and return `403` (Phase 71 fixed only `heatmap-build`, which now uses a
constant-time compare and a bare `404`). Both are now covered at the network layer by the
`dc34-gpx-internal-block` CloudFront function — verified live, 404 + `x-dc34-edge-block: 1` on
both spellings — so this is defence-in-depth, not an exposure. `strava-sync` also carries a
self-standing "never exposed via CloudFront" comment that was false before Phase 71 and is now
true only because of the edge block; it should say so.

Deliberately deferred until after DEF CON 34 (2026-08-05..10).
