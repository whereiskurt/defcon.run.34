# q.defcon.run resolver — spec corrections & open decisions

**Status:** Decisions needed (review before deploy)
**Date:** 2026-07-12
**Author:** Claude (overnight build for KPH)
**Parent spec:** `2026-07-11-qr-service-design.md` (Phases 2–4)

While building Phases 2–4 (resolver core + entities + rollup), codebase recon
contradicted two load-bearing assumptions in the parent spec. The **logic** was
built transport-agnostic and is fully tested; these two items are **your calls
to make before the Terraform is wired and deployed.**

---

## Resolved open questions (§12 of parent spec)

**Q1 — Global table: RESOLVED. No new table needed.**
`run-human-electro` is already a DynamoDB **Global Table v2** replicated to
`us-east-1` + `ca-central-1` + `ap-southeast-1`
(`infra/terraform/live/site/services/run.human/service.hcl:257-270`,
module `infra/terraform/modules/dynamodb/v1.0.0/main.tf:196-204`). The `qr`,
`ctf`, `qrstat` entities use `service: "run"` and attach to this table via
`RUN_ELECTRO_DBNAME` — same pattern as `apps/run.bib/lambda/reconcile/lib/entities.mjs`.

**Q5 — Region path convention: CONFIRMED.**
run.human mounts at `/{region}` via Next.js `basePath`
(`apps/run.human/webapp/next.config.ts:51`); `use1`/`cac1` are the segments.

---

## DECISION 1 — Reachability (blocks Terraform transport wiring)

**Spec said:** ALB listener rule → Lambda target group.

**Reality:** No ALB→Lambda target group exists anywhere in the repo, and the
public ALB's security group accepts 443 **only from the CloudFront
origin-facing prefix list** — direct-to-ALB public hostnames time out. This is
the *same* constraint that forced Phase 1 (`r./h./sao.`) off ALB rules and onto
CloudFront edge functions (see memory `reference_alb_cloudfront_only`).

So `q.defcon.run` **cannot** be reached direct-to-ALB. Two viable transports:

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. CloudFront → ALB → Lambda** (recommended) | New CloudFront distro for `q.` with cache disabled, Host forwarded; ALB gains a `q.` host rule → new Lambda target group | Keeps resolver as a normal regional Lambda (easy logs, easy DynamoDB, warm cache in-memory); mirrors how the ECS apps are fronted | Introduces the repo's first ALB→Lambda target group + first cache-disabled distro; two hops |
| **B. Lambda@Edge / CloudFront Function** | Resolver logic runs at the edge on viewer-request | One hop, no ALB | CloudFront Functions can't call DynamoDB (KV only, tiny); Lambda@Edge is us-east-1-authored, cold-starts globally, and DynamoDB reads from edge are high-latency; no in-memory warm cache benefit across POPs |

**Recommendation: Option A.** The resolver needs a DynamoDB `GetItem` per cold
code and an in-memory warm cache — both are natural in a regional Lambda and
awkward-to-impossible at the edge. The Terraform in this PR is scaffolded for A
(a `q-resolver` module with a Lambda + target group + listener rule) but is
**plan-only and not applied.** If you prefer B, the resolver core lib is written
to be transport-agnostic — only the thin `index.mjs` handler adapter changes.

---

## DECISION 2 — Region-awareness (no region cookie exists)

**Spec said:** resolver reads the run.human "region cookie" and rewrites
run.human destinations to `/use1//cac1/` accordingly (§6 step 5, §8).

**Reality:** **There is no region cookie.** Region is a *build/deploy-time* env
var (`REGION_SHORT` → `basePath`, `apps/run.human/webapp/next.config.ts:7,51`),
not a per-user value any edge component can read. run.human itself derives
region only from the URL path or falls back to the literal `"use1"`
(dozens of `|| "use1"` sites, e.g. `src/hooks/useLogout.ts:14-16`).

So a per-user, cookie-driven region rewrite is **not implementable as specced.**
Options for what the resolver injects when a destination targets run.human:

| Option | Behavior | Notes |
|--------|----------|-------|
| **A. Always `/use1`** (recommended for launch) | Every run.human destination gets `/use1/…` | Matches the app-wide default; `cac1` has no user-facing region selector today, so nobody is "supposed to" land on `/cac1`. Simplest, correct for the current product. |
| **B. Per-code `region` field** | Admin sets the region on each `qr` code (default `use1`) | Gives explicit control without inventing a per-user signal; a few codes could point at `/cac1` deliberately. Cheap to add. |
| **C. CloudFront geo header** | Derive region from `CloudFront-Viewer-Country` | Approximates "nearest region" but conflates *geography* with the app's *deploy regions*; a CA visitor isn't guaranteed a `cac1` account. Fragile. |

**Recommendation: Option A now, with the resolver's region value factored into a
single `resolveRegion()` seam** so upgrading to B (per-code field) later is a
one-function change. Implemented that way in `lib/respond.mjs`. Default is
`use1`; unknown/absent → `use1`.

---

## What this PR contains (built + tested, NOT deployed)

- `apps/run.qr/lambda/resolver/` — path parser, rule engine (time/param/`*`/fallback),
  enrichment (query-preserve + UTM + param append), region-aware response builder
  (Decision 2 = A behind a seam), structured log-line emitter (with the log-hygiene
  test: CTF handoff line never contains the submitted value), `qr`/`ctf`/`qrstat`
  ElectroDB entities, and a handler that glues them. Full vitest suite.
- `apps/run.qr/lambda/rollup/` — Logs Insights query builder (since-watermark) +
  log-line → `qrstat` aggregation (`total` / `day#` / `param#` / `ctf#`). Full vitest suite.
- `infra/terraform/modules/qr-resolver/v1.0.0/` — **scaffold** for Decision 1 = A,
  plan-only, clearly marked TODO where the transport is chosen.

## Deferred (deliberately, for your review)
- Deploy (`terragrunt apply`) — none run.
- The run.human **admin CRUD UI** for `qr`/`ctf` + scan counts (Phase 4 UI) — most
  app-invasive piece; benefits from your eyes and a design pass.
- **Phase 5 (CTF front-door + `/ctf/claim` judge)** — out of tonight's scope. The
  `ctf` entity + reserved-namespace parsing are present so Phase 5 slots in cleanly.
