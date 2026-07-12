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
`run-human-electro` is the shared table the `qr`/`ctf`/`qrstat` entities attach
to (`service: "run"`, via `RUN_ELECTRO_DBNAME` — same pattern as
`apps/run.bib/lambda/reconcile/lib/entities.mjs`). No new table is needed for the
resolver, which is **use1-only**.

> **CORRECTION (was overstated):** an earlier draft called this table "already a
> global table (use1+cac1+apse1)." It is **not** today. The `dynamodb` module
> filters replicas by `skip_regions` (`modules/dynamodb/v1.0.0/main.tf:196-204`),
> and `site.hcl:8` skips `ap-southeast-1` + `ca-central-1` — so the live table is
> **use1-only**. The `replica_regions` list (`service.hcl:257-270`) merely
> *declares* the intent. A future cac1/apse1 resolver would first need those
> regions un-skipped (which also lights up the replicas). Immaterial to this
> use1-only resolver.

**Q5 — Region path convention: CONFIRMED.**
run.human mounts at `/{region}` via Next.js `basePath`
(`apps/run.human/webapp/next.config.ts:51`); `use1`/`cac1`/`apse1` are the segments.
Note: only `use1` actually serves today (cac1/apse1 skipped); a bare, un-prefixed
path currently **404s** — see Decision 2.

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

## DECISION 2 — Region-awareness → **RESOLVED: region moves to the edge**

**Spec said:** resolver reads a run.human "region cookie" and rewrites run.human
destinations to `/use1//cac1/` (§6 step 5, §8).

**Reality:** **There is no region cookie.** Region is a *build/deploy-time* env
var (`REGION_SHORT` → `basePath`, `next.config.ts:7,51`); run.human derives region
only from the URL path or falls back to the literal `"use1"`. Worse, the run.human
distribution's only viewer-request function (`modules/cloudfront/v1.0.0`
`root_redirect`) is a **no-op**, so an un-prefixed path like `run.defcon.run/orderform`
**404s today** — there is nothing adding `/use1`.

**Decision (per KPH):** region prefixing is a **generic CloudFront edge behavior**,
not the resolver's job and not a run.human cookie. A viewer-request CloudFront
Function on *any* region-partitioned distribution decides the region
(sticky cookie → country-of-origin → default) and prepends `/{region}` when the
path lacks one. Consequences:

1. **The resolver is now region-LESS.** It emits **bare** `run.defcon.run/…` URLs
   (and a bare `run.defcon.run/ctf/claim?…`); the destination's own distribution
   prefixes the region on arrival. `resolveRegion`, the `x-qr-region` header, and
   all path-injection were **removed** from `lib/respond.mjs` / `resolve.mjs`. The
   log line keeps `geo` (country) for analytics but no longer carries `region`.
2. **New module `infra/terraform/modules/cloudfront-region-prefix/v1.0.0/`** — the
   reusable prefixer (viewer-request rewrite + viewer-response sticky cookie).
   - **Single- vs multi-region switch (per KPH):** the geo/cookie lookup only turns
     on when `served_regions > 1`. On a single-region deploy it drops to a cheap
     **static default prefix** (no cookie fn created), or can be disabled entirely
     (`enabled=false`) to override. Today = single-region (`["use1"]`) → everything
     `/use1/…`; the geo path is dormant until cac1/apse1 un-skip.
   - The `country_region_map` (`{ CA="cac1", SG="apse1", … }`) is the geo seam,
     default `{}`. Requires forwarding `CloudFront-Viewer-Country` (not enabled today).
   - Rewrite logic exercised against 12 mock CloudFront events (single + multi region,
     cookie override, country routing, idempotent passthrough, lookalike-segment safety).

**Coupling note:** region-less resolver + the prefixer must ship together — until a
prefixer exists on run.defcon.run, a bare redirect would hit today's 404. Deploying
the prefixer *also fixes* the existing bare-root 404. Neither is applied in this PR.

---

## What this PR contains (built + tested, NOT deployed)

- `apps/run.qr/lambda/resolver/` — path parser, rule engine (time/param/`*`/fallback),
  enrichment (query-preserve + UTM + param append), **region-less** response builder
  (bare run.defcon.run URLs; region is the edge's job — Decision 2), structured
  log-line emitter (log-hygiene test: CTF line never carries the submitted value),
  `qr`/`ctf`/`qrstat` ElectroDB entities, and a handler that glues them. Full vitest
  suite (97 tests).
- `infra/terraform/modules/cloudfront-region-prefix/v1.0.0/` — the reusable region
  prefixer (Decision 2), `terraform validate` clean, rendered JS syntax- and
  behavior-checked. Not wired to a live unit.
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
