---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 13
subsystem: infra
tags: [terraform, terragrunt, cloudfront, cache-policy, cloudfront-function, edge-block, blast-radius, CR-01, CR-03]
status: checkpointed

requires:
  - phase: 71-10
    provides: "the public heat-map route and heatmap-artifact lib, whose in-file CDN comments cite plan 71-13 BY NAME and whose response-size bounds are sized on the premise that this cache behaviour exists"
  - phase: 71-11
    provides: "CR-01's application half — the internal build route's constant-time secret compare and bare 404 with no handler body. This plan is the network half."
  - phase: 71-12
    provides: "the 19-assertion production probe; assertions 1, 2 and 8 grade this plan, assertion 16 is the blast-radius regression gate that must stay green"
provides:
  - "aws_cloudfront_function.internal_block — an edge-level marked 404 for the whole gpx internal API family (CR-01 network half)"
  - "aws_cloudfront_cache_policy.heatmap_artifact — min 0 / default 900 / max 3600, cookies+headers none, query-string whitelist exactly [meta] (CR-03)"
  - "three gpx-gated ordered cache behaviours authored ABOVE the /{region}/* ALB wildcard"
  - "a re-derived, command-backed blast-radius table for every internal-route caller in the monorepo"
affects: [71-15, 71-16, run.gpx, run.human, run.auth, run.mqtt]

tech-stack:
  added: []
  patterns:
    - "each.key == \"<domain>\"-gated dynamic ordered_cache_behavior — first use of a gpx gate in a file that previously gated only on run and cms"
    - "CloudFront Function as a viewer-request refusal with a response marker header, so a probe can tell an EDGE refusal from an APPLICATION rejection"
    - "Cache policy authored explicitly rather than reusing Managed-CachingOptimized, because the managed policy drops query strings from the key"

key-files:
  created: []
  modified:
    - infra/terraform/modules/cloudfront/v1.0.0/main.tf

key-decisions:
  - "71-13: the edge block is scoped to the gpx distribution AND the /api/gpx/internal/ prefix only — NOT a blanket /{region}/api/*/internal/* across all 15 distributions — because run.mqtt/meshtk mints ghost claim links against run.human's POST /api/internal/ctf/mint over PUBLIC HTTPS"
  - "71-13: the no-region form /api/gpx/internal/* is covered as well as the region-prefixed form, because the run.gpx ALB listener rule carries NO path_patterns and the default_cache_behavior forwards everything"
  - "71-13: 404 not 403 at the edge, matching the estate's non-disclosure posture; and the FULL method set is allowed on the block so CloudFront never short-circuits to an UNMARKED 403 before the function runs"
  - "71-13: post-change ordered-behaviour count is 21 of the 25 quota (headroom 4) — below the plan's 22 threshold, so the full three-region shape shipped and NO fallback collapse to use1-only was applied"
  - "71-13: terragrunt-plan.yml cannot scope a global unit — its modules input is only honoured when region is ALSO set, and is then resolved as region/$REGION/$MODULE. The scoped dispatch therefore fell through to a CI-side read-only plan of every unit. Recorded, not worked around."

metrics:
  duration: ~35 min
  completed: 2026-07-31
  tasks_completed: 3
  tasks_total: 4
---

# Phase 71 Plan 13: CloudFront Edge Block + Heat-Map Cache Behaviour Summary

Two new global CloudFront resources and three gpx-gated ordered cache behaviours authored
above the `/{region}/*` ALB wildcard — closing CR-03 (repeat heat-map fetches all missed the
edge) and CR-01's network half (the internal build route was reachable from the open
internet) in one file, proven confined by a CI plan of `2 to add, 1 to change, 0 to destroy`.

**STATUS: CHECKPOINTED at Task 3b. Task 4 (the scoped apply and the live re-derivation of
both fixes) is DEFERRED, not skipped — see "Task 4: DEFERRED" below.**

---

## Task 1: Blast radius re-derived from the repo — raw output

### (a) Every internal API route in the monorepo

`find apps -path "*/api/*/internal/*" -name "route.ts" -not -path "*/node_modules/*" -not -path "*/.next/*"`

```
apps/run.gpx/webapp/src/app/api/gpx/internal/heatmap-build/route.ts
apps/run.gpx/webapp/src/app/api/gpx/internal/reconcile/route.ts
apps/run.gpx/webapp/src/app/api/gpx/internal/strava-sync/route.ts
```

`find apps -path "*/api/internal/*" -name "route.ts" -not -path "*/node_modules/*" -not -path "*/.next/*"`

```
apps/run.auth/webapp/src/app/api/internal/auth-profiles/services/route.ts
apps/run.auth/webapp/src/app/api/internal/quota/[userId]/[quotaId]/consume/route.ts
apps/run.auth/webapp/src/app/api/internal/quota/[userId]/[quotaId]/restore/route.ts
apps/run.auth/webapp/src/app/api/internal/quota/[userId]/route.ts
apps/run.auth/webapp/src/app/api/internal/quota/by-type/[quotaId]/route.ts
apps/run.auth/webapp/src/app/api/internal/strava-tokens/route.ts
apps/run.human/webapp/src/app/api/internal/accomplishment/reconcile/route.ts
apps/run.human/webapp/src/app/api/internal/accomplishment/route.ts
apps/run.human/webapp/src/app/api/internal/ctf/mint/route.ts
apps/run.human/webapp/src/app/api/internal/ctf/unlock-award/route.ts
apps/run.human/webapp/src/app/api/internal/ghost-unlock/route.ts
apps/run.human/webapp/src/app/api/internal/mesh-map/route.ts
apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts
apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts
```

**Confirmed:** exactly THREE live under `apps/run.gpx/webapp/src/app/api/gpx/internal/`.
The other fourteen live under run.auth's and run.human's `api/internal/` — a **different
path prefix** (`/api/internal/…`, no `gpx` segment) on **different distributions**
(`auth.defcon.run`, `run.defcon.run`). The `path_pattern` this plan adds,
`/api/gpx/internal/*`, cannot match any of them even if it were applied to their
distributions, which it is not.

### (b) Every caller of an internal route

`grep -rn "api/internal\|api/gpx/internal" --include="*.ts" --include="*.hcl" --include="*.mjs" apps infra | grep -v "src/app/api" | grep -v node_modules`

```
apps/run.auth/webapp/src/lib/runhuman-resolve.ts:17:// route lives at `/{region}/api/internal/...`. A naked `https://run.defcon.run/
apps/run.auth/webapp/src/lib/runhuman-resolve.ts:18:// api/internal/...` 404s → the auth-admin run.human tie-back returned not-found
apps/run.auth/webapp/src/lib/runhuman-resolve.ts:27:    const res = await fetchImpl(`${BASE}/api/internal/user/${encodeURIComponent(sub)}?summary=1`, {
apps/run.auth/webapp/src/lib/runhuman-resolve.test.ts:26:  it("targets run.human's region-prefixed internal route (not a naked /api/internal that 404s)", async () => {
apps/run.auth/webapp/src/lib/runhuman-resolve.test.ts:30:    // Must hit /{region}/api/internal/... — regression guard for the missing-basePath 404.
apps/run.bib/webapp/src/__tests__/social-qr.test.ts:118:      "http://human.internal.test/use1/api/internal/user/sub-x",
apps/run.bib/webapp/src/__tests__/rabbit-name-sync.test.ts:31:    expect(String(url)).toContain("/api/internal/user/sub-1");
apps/run.bib/webapp/src/__tests__/rabbit-name-sync.test.ts:95:    expect(String(url)).toContain("/api/internal/user/sub-pay");
apps/run.bib/webapp/src/lib/social-qr.ts:54:    const url = `${HUMAN_BASE_URL}/api/internal/user/${encodeURIComponent(
apps/run.bib/webapp/src/lib/social-qr.ts:104:    const url = `${HUMAN_BASE_URL}/api/internal/user/${encodeURIComponent(ownerSub)}`;
apps/run.bib/webapp/src/lib/quota-client.ts:121:  return quotaRequest<UserQuotasResponse>(`/api/internal/quota/${userId}`);
apps/run.bib/webapp/src/lib/quota-client.ts:174:    }>(`/api/internal/quota/${userId}/${quotaId}/consume`, {
apps/run.bib/webapp/src/lib/quota-client.ts:214:  }>(`/api/internal/quota/${userId}/${quotaId}/restore`, {
apps/run.gpx/webapp/src/lib/ghost-unlock.ts:36:      `${RUN_HUMAN_URL}/api/internal/ghost-unlock?ghost=ghost.goldstein`,
apps/run.gpx/webapp/src/lib/strava-sync.test.ts:342:        if (u.includes("/api/internal/strava-tokens")) {
apps/run.gpx/webapp/src/lib/strava-sync.test.ts:436:        if (u.includes("/api/internal/strava-tokens")) {
apps/run.gpx/webapp/src/lib/strava-sync.test.ts:464:        if (u.includes("/api/internal/strava-tokens")) {
apps/run.gpx/webapp/src/lib/strava-sync.test.ts:485:        if (u.includes("/api/internal/strava-tokens")) {
apps/run.gpx/webapp/src/lib/gpx-reconcile.test.ts:91:    // POST to /api/internal/accomplishment
apps/run.gpx/webapp/src/lib/gpx-reconcile.ts:116:    const res = await doFetch(humanInternalUrl("/api/internal/accomplishment/reconcile"), {
apps/run.gpx/webapp/src/lib/quota-client.ts:117:  return quotaRequest<UserQuotasResponse>(`/api/internal/quota/${userId}`);
apps/run.gpx/webapp/src/lib/quota-client.ts:170:    }>(`/api/internal/quota/${userId}/${quotaId}/consume`, {
apps/run.gpx/webapp/src/lib/quota-client.ts:210:  }>(`/api/internal/quota/${userId}/${quotaId}/restore`, {
apps/run.gpx/webapp/src/lib/heatmap-build.ts:6: * Invoked by `POST /api/gpx/internal/heatmap-build` on an EventBridge schedule.
apps/run.gpx/webapp/src/lib/strava-sync.ts:264:  const res = await fetch(`${authUrl}/api/internal/strava-tokens`, {
apps/run.gpx/webapp/src/lib/strava-sync.ts:397:    `${authUrl}/api/internal/strava-tokens?userId=${encodeURIComponent(userId)}`,
apps/run.gpx/webapp/src/lib/gpx-accomplishment.ts:120: * Assemble the exact run.human `/api/internal/accomplishment` contract object.
apps/run.gpx/webapp/src/lib/gpx-accomplishment.ts:202:    const url = humanInternalUrl("/api/internal/accomplishment");
apps/run.human/webapp/src/lib/accomplishment-reconcile.ts:4: * The internal reconcile endpoint (`api/internal/accomplishment/reconcile`)
apps/run.human/webapp/src/lib/quota-client.ts:117:  return quotaRequest<UserQuotasResponse>(`/api/internal/quota/${userId}`);
apps/run.human/webapp/src/lib/quota-client.ts:142:      `/api/internal/quota/by-type/${quotaId}`
apps/run.human/webapp/src/lib/quota-client.ts:172:      `/api/internal/auth-profiles/services`
apps/run.human/webapp/src/lib/quota-client.ts:249:    }>(`/api/internal/quota/${userId}/${quotaId}/consume`, {
apps/run.human/webapp/src/lib/quota-client.ts:289:  }>(`/api/internal/quota/${userId}/${quotaId}/restore`, {
apps/run.human/webapp/src/entities/bib.ts:22: * OIDC sub via the accounts table first (mirrors api/internal/user/[oidcSub],
apps/run.human/webapp/src/lib/ctf-pending.ts:32: * TTL for a ghost claim-link nonce (minted by /api/internal/ctf/mint): short
infra/terraform/live/site/region/us-east-1/strava-sync-scheduler/terragrunt.hcl:101:  sync_url                      = "${local.gpx_internal_origin}/${local.region_label}/api/gpx/internal/strava-sync"
infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl:108:  sync_url                      = "${local.gpx_internal_origin}/${local.region_label}/api/gpx/internal/heatmap-build"
infra/terraform/live/site/services/run.mqtt/service.hcl:343:            # (POST /api/internal/ctf/mint). Public HTTPS is fine — the call is
```

### Caller-classification table

| Caller | Target route | Env var / local supplying base URL | Value | Cloud Map or public host? | Blocked by this change? |
|---|---|---|---|---|---|
| `heatmap-scheduler` invoker Lambda | **run.gpx** `/{region}/api/gpx/internal/heatmap-build` | `sync_url` from local `gpx_internal_origin` | `http://run-gpx.app-${region}-${site}.local:3000` | **Cloud Map private** | No — never traverses CloudFront |
| `strava-sync-scheduler` invoker Lambda | **run.gpx** `/{region}/api/gpx/internal/strava-sync` | `sync_url` from local `gpx_internal_origin` | `http://run-gpx.app-${region}-${site}.local:3000` | **Cloud Map private** | No — never traverses CloudFront |
| run.human admin recalculate route (`api/admin/users/[userId]/recalculate/route.ts:62`) | **run.gpx** `/api/gpx/internal/reconcile` | `RUN_GPX_INTERNAL_URL` | `http://run-gpx.app-{{REGION_LABEL}}-{{SITE_LABEL}}.local:3000/{{REGION_LABEL}}` | **Cloud Map private** | No — never traverses CloudFront |
| **run.mqtt / meshtk** ghost claim-link mint | **run.human** `/{region}/api/internal/ctf/mint` | **`MESHTK_RUN_INTERNAL_URL`** | **`https://run.{{SITE_DOMAIN}}/{{REGION_LABEL}}`** | **PUBLIC HTTPS** | **No — different distribution AND different prefix; deliberately untouched** |
| run.auth admin tie-back (`runhuman-resolve.ts`) | run.human `/{region}/api/internal/user/…` | `BASE` (run.human public base) | public host | public HTTPS | No — different distribution and prefix |
| run.bib social-QR / rabbit-name-sync | run.human `/api/internal/user/…` | `HUMAN_BASE_URL` | public host | public HTTPS | No — different distribution and prefix |
| run.bib / run.gpx / run.human quota clients | run.auth `/api/internal/quota/…` | auth internal URL | Cloud Map / public | mixed | No — different distribution and prefix |
| run.gpx strava-token fetch | run.auth `/api/internal/strava-tokens` | `authUrl` (`AUTH_INTERNAL_URL`) | Cloud Map private | Cloud Map private | No |
| run.gpx ghost-unlock | run.human `/api/internal/ghost-unlock` | `RUN_HUMAN_URL` | — | — | No — different distribution and prefix |

### (c) The two required conclusions — BOTH HOLD

1. **Every caller of a run.gpx internal route uses the Cloud Map private name.** All three
   (`heatmap-build`, `strava-sync`, `reconcile`) are reached only at
   `http://run-gpx.app-{region}-{site}.local:3000`. A gpx-scoped **edge** block sits on
   CloudFront, which none of them traverse. It cannot break any of them.

2. **At least one caller of a NON-gpx internal route uses public HTTPS.** From
   `infra/terraform/live/site/services/run.mqtt/service.hcl`:

   ```hcl
   {
     # run.human base URL for the single-use flag-claim mint endpoint
     # (POST /api/internal/ctf/mint). Public HTTPS is fine — the call is
     # guarded by MESHTK_INTERNAL_SECRET. Unset/unreachable degrades to
     # the static-code reveal (meshtk fail-safe).
     name  = "MESHTK_RUN_INTERNAL_URL"
     value = "https://run.{{SITE_DOMAIN}}/{{REGION_LABEL}}"
   }
   ```

   **`MESHTK_RUN_INTERNAL_URL` points at the run host over public HTTPS.** This is the
   evidence behind the blanket-block prohibition: widening the edge block to
   `/{region}/api/*/internal/*` across all distributions would silently kill meshtk's ghost
   claim-link mint — a con-critical CTF flow. The block is therefore scoped to the gpx
   distribution and the `/api/gpx/internal/` prefix only. Probe assertion 16 gates this.

**Supporting fact (why the naked path also needs covering):** `run.gpx/service.hcl` listener:

```hcl
listener = {
  port         = 443
  protocol     = "HTTPS"
  host_headers = ["gpx.{{SITE_DOMAIN}}"]
  # No path_patterns - route all gpx.<domain> requests to run-gpx
  # This allows Auth.js callbacks without region prefix to work
}
```

No `path_patterns` — every gpx-host request reaches the app, region-prefixed or not.

### (d) The ordering constraint, quoted verbatim from the file

From the Impart canary behaviour (`main.tf`, immediately above the ALB wildcard):

> ```
> # ORDERING IS LOAD-BEARING: this exact-path behavior MUST be authored BEFORE the
> # /{region}/* ALB wildcard below; CloudFront picks the first matching behavior.
> ```

And again from the CTF-12 theme behaviour:

> ```
> # ORDERING IS LOAD-BEARING: this exact-path behavior MUST be authored BEFORE the
> # /{region}/assets/* S3 wildcard below. CloudFront selects the FIRST matching
> # behavior in list order; if the wildcard preceded this, /use1/assets/theme would
> # be grabbed by S3 (wrong origin, cached, no cookie) and the covert channel dies.
> ```

CloudFront selects the first matching behaviour in list order; Terraform emits
`ordered_cache_behavior` blocks in source order; therefore both new families must be
authored above the `/{region}/*` dynamic block. They are.

**Verify command:** `grep -c "MESHTK_RUN_INTERNAL_URL" infra/terraform/live/site/services/run.mqtt/service.hcl` → `1`

---

## Task 2: The Terraform change

**Commit:** `50efc526` — `feat(71-13): gpx-scoped edge block + heat-map cache behaviour on CloudFront`
**File:** `infra/terraform/modules/cloudfront/v1.0.0/main.tf` (only file touched)

### What was added

| Kind | Address | Notes |
|---|---|---|
| resource | `aws_cloudfront_function.internal_block` | `cloudfront-js-2.0`, `publish = true`, global-application provider. Returns `404 / Not Found` with the marker response header. |
| resource | `aws_cloudfront_cache_policy.heatmap_artifact` | `heatmap-artifact-defcon-run`. min 0 / **default 900** (agrees with the route's `CACHE_SECONDS = 900`) / max 3600. gzip + brotli in key. cookies `none`, headers `none`, query strings **whitelist `["meta"]`**. |
| behaviour | `/${region}/api/gpx/internal/*` | dynamic over gpx ALB-bearing origins. Full method set. CachingDisabled. `internal_block` on viewer-request. |
| behaviour | `/api/gpx/internal/*` | static, no-region form. Same shape. |
| behaviour | `/${region}/api/gpx/public/heatmap/*` | dynamic over gpx ALB-bearing origins. GET/HEAD/OPTIONS, compress, `cache_policy_id = aws_cloudfront_cache_policy.heatmap_artifact.id`. |

All three behaviours are gated `each.key == "gpx"` and authored immediately **before** the
`/{region}/*` ALB wildcard. `default_cache_behavior`, the wildcard block, and every existing
behaviour are untouched.

### Acceptance criteria — all measured

| Criterion | Command | Result |
|---|---|---|
| `terraform fmt -check` clean | `terraform fmt -check main.tf` | **exit 0** |
| function resource exists | `grep -c 'resource "aws_cloudfront_function" "internal_block"'` | **1** |
| cache policy exists | `grep -c 'resource "aws_cloudfront_cache_policy" "heatmap_artifact"'` | **1** |
| marker spelled exactly once | `grep -c "x-dc34-edge-block"` | **1** |
| gpx gates (was 0 before this plan) | `grep -c 'each.key == "gpx"'` | **3** |
| query-string whitelist is exactly `meta` | `grep -A2 "query_string_behavior" \| grep -c '"meta"'` | **1** |
| Managed-CachingOptimized NOT used on heat-map | read | `cache_policy_id = aws_cloudfront_cache_policy.heatmap_artifact.id`; the `658327ea-…` literal appears only on the pre-existing S3/static behaviours |
| ordering holds | `grep -n "path_pattern"` | new patterns at **627**, **655**, **694**; the `/${…}/*` wildcard at **717**. All three are above it. |
| module validates | `terraform init -backend=false && terraform validate` (scratch copy with stub provider aliases) | **`Success! The configuration is valid.`** |

`terragrunt validate` was **not** run locally against the live unit — the live global unit
requires assuming the CI role and reading remote state, which is what the CI plan in Task 3
does properly. The module was validated in isolation instead, and Task 3's CI plan is the
authoritative check.

---

## Task 3: Scoped CI plan and the diff shape

**Run:** https://github.com/whereiskurt/defcon.run.34/actions/runs/30653364910
**Run id:** `30653364910` — conclusion **success**
**Dispatch:** `gh workflow run terragrunt-plan.yml --ref gsd/phase-71-heat-map-layers -f modules=global/cloudfront`

**The plan ran in CI under the `dc34-github-readonly` role. NO local `terragrunt apply` was
run at any point in this plan. NO `--with-terragrunt`. NO local `plan --all`.**

### Deviation: `terragrunt-plan.yml` cannot scope a global unit

The plan's `read_first` states that a `modules` entry containing a slash is resolved as a
path relative to `live/site`. **That is true of `terragrunt-apply.yml` but NOT of
`terragrunt-plan.yml`.** The plan workflow's dispatch logic is:

```bash
if [[ -n "$REGION" && -n "$MODULES" ]]; then
  ... (cd "region/$REGION/$MODULE" && terragrunt plan --no-color) ...
elif [[ -n "$REGION" ]]; then
  ... (cd "region/$REGION" && terragrunt run plan --all --no-color) ...
else
  echo "Planning all modules in all regions..."
  terragrunt run plan --all --no-color ...
fi
```

There is **no modules-only branch**. `modules` is honoured only when `region` is also set,
and is then resolved as `region/$REGION/$MODULE` — a `global/…` unit can never be addressed
that way. Passing `-f modules=global/cloudfront` with no region therefore fell through to
the read-only "plan everything" branch. This was **not** worked around (adding a region
would have been wrong, and editing the workflow is out of scope for this plan) and was not a
prohibition breach: the prohibition is on a **local** `plan --all`; this was CI, read-only,
under the readonly role, and it produced strictly more evidence than a scoped run would have.

**Filed for post-con:** `terragrunt-plan.yml` should grow the same slash-aware module
resolution `terragrunt-apply.yml` already has, so a global unit can be planned in isolation.

**The apply must still be dispatched scoped** — `terragrunt-apply.yml` DOES honour
`modules=global/cloudfront`, and that is the command recorded under Task 4 below.

### The `global/cloudfront` plan line — verbatim

```
18:07:03.443 STDOUT [global/cloudfront] terraform: Plan: 2 to add, 1 to change, 0 to destroy.
```

**Exactly the expected shape.**

### Resources ADDED (2)

```
# aws_cloudfront_cache_policy.heatmap_artifact will be created
  + resource "aws_cloudfront_cache_policy" "heatmap_artifact" {
      + default_ttl = 900
      + max_ttl     = 3600
      + min_ttl     = 0
      + name        = "heatmap-artifact-defcon-run"
      + parameters_in_cache_key_and_forwarded_to_origin {
          + enable_accept_encoding_brotli = true
          + enable_accept_encoding_gzip   = true
          + cookies_config { + cookie_behavior = "none" }
          + headers_config { + header_behavior = "none" }
          + query_strings_config {
              + query_string_behavior = "whitelist"
              + query_strings { + items = [ + "meta", ] }
            }
        }
    }

# aws_cloudfront_function.internal_block will be created
  + resource "aws_cloudfront_function" "internal_block" {
      + code            = <<-EOT
            function handler(event) {
              return {
                statusCode: 404,
                statusDescription: 'Not Found',
                headers: {
                  'x-dc34-edge-block': { value: '1' }
                }
              };
            }
        EOT
      + comment         = "Edge-refuses the gpx internal API family with a marked 404"
      + name            = "dc34-gpx-internal-block"
      + publish         = true
      + runtime         = "cloudfront-js-2.0"
    }
```

### Resource CHANGED (1) — and it is the gpx distribution

```
# aws_cloudfront_distribution.main["gpx"] will be updated in-place
  ~ resource "aws_cloudfront_distribution" "main" {
        id   = "E1D1R5LJNFGRLE"
        tags = { "Domain" = "gpx.defcon.run" ... }
```

The for_each key in the address is **`"gpx"`**. **Exactly one distribution changes.** The
other fourteen distributions in this unit show no diff at all. Zero destroyed.

### Resources DESTROYED: 0

### Reading the diff — an insert, not a displacement

Terraform renders `ordered_cache_behavior` positionally, so an insert in the middle of the
list appears as "the tail moved up and new blocks were appended". The rendered diff is 3 `~`
(mutated) + 7 `+` (added) + 0 `-`:

| Rendered as | Path pattern |
|---|---|
| `~` | `"/apse1/*"` → `"/apse1/api/gpx/internal/*"` (+ function_association) |
| `~` | `"/cac1/*"` → `"/cac1/api/gpx/internal/*"` (+ function_association) |
| `~` | `"/use1/*"` → `"/use1/api/gpx/internal/*"` (+ function_association) |
| `+` | `/api/gpx/internal/*` |
| `+` | `/apse1/api/gpx/public/heatmap/*` |
| `+` | `/cac1/api/gpx/public/heatmap/*` |
| `+` | `/use1/api/gpx/public/heatmap/*` |
| `+` | `/apse1/*` |
| `+` | `/cac1/*` |
| `+` | `/use1/*` |

The three `/{region}/*` wildcards are re-emitted at the **END** of the list. That is the
proof the ordering is right: the resulting behaviour list is

```
 1-11  (unchanged) /index.html, /favicon.ico, 3x /{r}/index.html,
                   3x /{r} bare, 3x /{r}/assets/*
12     /apse1/api/gpx/internal/*
13     /cac1/api/gpx/internal/*
14     /use1/api/gpx/internal/*
15     /api/gpx/internal/*
16     /apse1/api/gpx/public/heatmap/*
17     /cac1/api/gpx/public/heatmap/*
18     /use1/api/gpx/public/heatmap/*
19     /apse1/*
20     /cac1/*
21     /use1/*
```

All six new patterns precede the wildcards. No existing behaviour is destroyed or displaced
out of order — the `0 to destroy` confirms it.

### ORDERED-BEHAVIOUR QUOTA CHECK

| | Count |
|---|---|
| gpx distribution `ordered_cache_behavior` count **before** (measured live: `aws cloudfront get-distribution-config --id E1D1R5LJNFGRLE`) | **14** |
| New behaviours contributed by this change | **+7** (3 internal-per-region + 1 internal-no-region + 3 heatmap-per-region) |
| **gpx distribution `ordered_cache_behavior` count AFTER** | **21** |
| CloudFront default limit | **25** |
| **Headroom remaining** | **4** |

**21 is below the plan's documented 22 threshold, so the full three-region shape shipped and
NO fallback collapse was applied.** For the record, had the count reached 22 the documented
fallbacks were (i) collapse the internal block to the no-region form plus use1 only (both
scheduler units live under `region/us-east-1/`; there is no cac1 or apse1 heatmap or
strava-sync unit), saving 2; and (ii) scope the heat-map behaviour to use1 only, saving 2 more.

Live baseline before the change, for the record:

```
  Origin   |        Path
-----------+---------------------
  s3-use1  |  /index.html
  s3-use1  |  /favicon.ico
  s3-apse1 |  /apse1/index.html
  s3-cac1  |  /cac1/index.html
  s3-use1  |  /use1/index.html
  impart   |  /apse1
  impart   |  /cac1
  impart   |  /use1
  s3-apse1 |  /apse1/assets/*
  s3-cac1  |  /cac1/assets/*
  s3-use1  |  /use1/assets/*
  impart   |  /apse1/*
  impart   |  /cac1/*
  impart   |  /use1/*
```

### Note for the reviewer: gpx's Impart state is "on"

The plan output shows `target_origin_id = "impart"` and
`origin_request_policy_id = "33f36d7e-…"` (Managed-AllViewerAndCloudFrontHeaders) on all
three new behaviours. That is **correct and unchanged from today** — the existing
`/{region}/*` wildcard already targets `impart`, and the new blocks use the same conditional
expressions (`contains(local.impart_on_domains, each.key) ? … : …`) that the wildcard and the
default behaviour use. The edge block never reaches its origin at all; the heat-map behaviour
reaches Impart on a cache miss exactly as every other gpx request already does. No new path
and no WAF-bypass side door was introduced.

### Other units in the run — none caused by this change

The unscoped run also planned every other unit. None of the diffs below touch anything this
commit modified; all are pre-existing drift or a sibling plan's work:

| Unit | Shape | Attribution |
|---|---|---|
| `region/us-east-1/bib-secrets` | 0 add / 9 change / 0 destroy | pre-existing SSM parameter drift |
| `region/us-east-1/abuse-detection` | 1 add / 0 / 0 | pre-existing `aws_sns_topic_subscription.abuse_email` |
| `region/us-east-1/heatmap-scheduler` | 0 / 5 / 0 | **plan 71-14**, already committed, awaiting the same post-merge apply |
| `region/us-east-1/ecs-task` | 3 add / 0 / 3 destroy | pre-existing task-definition replacements (run-flash, run-gpx, run-mqtt) — image/version drift, not this commit |
| **`global/cloudfront`** | **2 / 1 / 0** | **this plan** |
| all other units | `No changes.` | — |

### checkov

`gh run list --workflow=checkov-scan.yml` returns `[]` — the scan is PR-triggered and there
is no PR for this branch yet, so it has not evaluated the new behaviours. It will run on the
infra PR that carries this commit to main; **any finding must be recorded and dispositioned
there, not suppressed.**

---

## Task 3b: BLOCKING REVIEW — the checkpoint this plan stops at

See the CHECKPOINT block returned to the orchestrator. In short:

1. **Plan shape:** `Plan: 2 to add, 1 to change, 0 to destroy.` — the single changed address
   is `aws_cloudfront_distribution.main["gpx"]` (id `E1D1R5LJNFGRLE`, `gpx.defcon.run`).
2. **Blast radius:** all three run.gpx internal callers use the Cloud Map private name
   (`sync_url` ×2, `RUN_GPX_INTERNAL_URL`) — none traverse CloudFront.
3. **Not blocked:** `MESHTK_RUN_INTERNAL_URL = https://run.{{SITE_DOMAIN}}/{{REGION_LABEL}}`
   — different distribution, different prefix, deliberately untouched. Probe assertion 16
   gates it and must stay green.
4. **Quota:** 21 of 25, headroom 4, below the 22 threshold; full shape shipped, no fallback.
5. **Ordering:** the three new pattern families occupy list positions 12–18; the
   `/{region}/*` wildcards are re-emitted at 19–21.

---

## Task 4: DEFERRED — not skipped

**Task 4 (the scoped apply and the live re-derivation of both fixes) was NOT executed, and
could not have been from this branch.**

The `terraform-apply` GitHub environment has exactly one deployment-branch policy: `main`.
Plan 71-14 proved this empirically — its `terragrunt-apply.yml` dispatch from
`gsd/phase-71-heat-map-layers` failed in 2 seconds with zero steps executed:

> Branch "gsd/phase-71-heat-map-layers" is not allowed to deploy to terraform-apply due to
> environment protection rules.

`terragrunt-apply.yml`'s `workflow_dispatch` has no `ref` input (only its `workflow_call`
does), so there is no way to apply phase-branch code without landing it on main first.

**Kurt's decision (2026-07-31):** an infra-only PR carrying 71-14's three commits
(`d49f928d`, `f5ab57c8`, `924b0d82`) plus this plan's `50efc526` goes to main, he approves
the merge, and THEN both scoped applies run from main. Task 4 is the orchestrator's to
dispatch after that merge.

### Resume commands for Task 4 — run these from `main` after the infra PR merges

**Step 1 — the scoped apply (this plan's half):**

```bash
gh workflow run terragrunt-apply.yml -f modules=global/cloudfront
gh run watch <run-id> --exit-status
```

Record the run URL and confirm the apply summary matches `2 to add, 1 to change, 0 to
destroy`. **CloudFront distribution updates propagate for several minutes after the apply
returns** — wait for `Status: Deployed` before probing:

```bash
AWS_PROFILE=dc34-application aws cloudfront get-distribution \
  --id E1D1R5LJNFGRLE --query 'Distribution.Status' --output text
```

**Step 2 (a) — CR-03: repeat fetches must hit the edge.**

```bash
for i in 1 2 3 4; do
  curl -sD- -o /dev/null 'https://gpx.defcon.run/use1/api/gpx/public/heatmap/dc33' \
    | grep -i '^x-cache:'
done
# EXPECT: request 1 "Miss from cloudfront"; at least one of 2-4 "Hit from cloudfront".
# PRE-FIX this was 4x Miss (probe edge-hits=0/3) — probe assertions 1 and 2.

# The two cache entries must be separate:
curl -s  'https://gpx.defcon.run/use1/api/gpx/public/heatmap/dc33'          | wc -c
curl -s  'https://gpx.defcon.run/use1/api/gpx/public/heatmap/dc33?meta=1'   | wc -c
# EXPECT: materially different byte counts (full artifact ~441 KB vs a few hundred bytes).
```

**Step 2 (b) — CR-01: all six internal-path probes must return a MARKED 404.**

```bash
for p in heatmap-build strava-sync reconcile; do
  for u in "https://gpx.defcon.run/use1/api/gpx/internal/$p" \
           "https://gpx.defcon.run/api/gpx/internal/$p"; do
    echo "--- $u"
    curl -sS -X POST -D- -o /dev/null "$u"
  done
done
# EXPECT for all six: HTTP/2 404 AND a "x-dc34-edge-block: 1" response header.
# MUST NOT contain the application's own {"error":"Forbidden"} body — probe assertion 8.
```

**Step 2 (c) — BLAST-RADIUS REGRESSION GATE. If either of these carries the marker, the
block is too wide and must be narrowed immediately.**

```bash
curl -sD- -o /dev/null 'https://run.defcon.run/use1/api/internal/ctf/mint'
curl -sD- -o /dev/null 'https://auth.defcon.run/use1/api/internal/quota/probe-nonexistent-user'
# EXPECT: mint -> 405, quota -> 401, and NEITHER carrying the marker header.
# This is probe assertion 16 and it is GREEN pre-fix; keeping it green matters as much as
# turning assertion 8 red-to-green.
```

**Step 2 (d) — the scheduled path must still work. Most important post-apply check, because
this failure mode is silent.**

```bash
AWS_PROFILE=dc34-application AWS_REGION=us-east-1 \
  aws lambda invoke --function-name heatmap-build-use1 \
  --cli-binary-format raw-in-base64-out --payload '{}' /tmp/heatmap-invoke.json
cat /tmp/heatmap-invoke.json
# EXPECT a 200 in a few seconds with {"ok":true,"year":"dc34",...}.
# 71-14's pre-apply baseline was 200 in 2.5 s with {"ok":true,"year":"dc34",...,"runCount":0},
# so the VPC-private Cloud Map hop is known intact — a failure here is THIS change, not
# pre-existing. Structurally the Lambda never traverses CloudFront, but the check exists
# precisely because a mistake would stop the heat map updating during the con with no visible
# error.
```

**Step 3 — re-run the 71-12 production probe** and confirm assertions 1, 2 and 8 flip to
green while 16 stays green.

Feed all output back so it can be folded into this SUMMARY and the plan closed.

---

## Deviations from Plan

### 1. [Rule 3 — blocking issue, documented not worked around] `terragrunt-plan.yml` cannot scope a global unit

- **Found during:** Task 3
- **Issue:** The plan's `read_first` asserted that a slash-bearing `modules` entry resolves
  relative to `live/site` in `terragrunt-plan.yml`. It does not — that logic exists only in
  `terragrunt-apply.yml`. The plan workflow honours `modules` only when `region` is also set,
  and then joins it as `region/$REGION/$MODULE`.
- **Effect:** `-f modules=global/cloudfront` with no region fell through to the read-only
  "plan everything" branch. `global/cloudfront` was still planned, and its diff is
  unambiguous and quoted above.
- **Fix:** None applied. Not a prohibition breach (CI, read-only, readonly IAM role — the
  prohibition is on a *local* `plan --all`), and the unscoped run produced strictly more
  evidence: every other unit's diff is visible and attributable. Adding a region would have
  been wrong for a global unit; editing the workflow is out of scope for this plan.
- **Filed for post-con:** give `terragrunt-plan.yml` the slash-aware module resolution
  `terragrunt-apply.yml` already has.
- **The apply is unaffected** — `terragrunt-apply.yml` DOES honour `modules=global/cloudfront`.

### 2. [Scope decision] `terragrunt validate` on the live unit replaced with an isolated module validate

- **Found during:** Task 2
- **Issue:** `terragrunt validate` on `live/site/global/cloudfront` needs an assumed CI role
  and remote state; running it locally would have been a credentialed read against production
  state for no additional signal.
- **Fix:** Validated the module in isolation instead — a scratch copy plus stub provider
  aliases, `terraform init -backend=false && terraform validate` →
  `Success! The configuration is valid.` The plan explicitly allows this fallback ("If
  credentials are unavailable locally, note it and rely on Task 3's CI plan"), and Task 3's
  CI plan is the authoritative check.

### 3. [Deferred by orchestrator decision] Task 4 not executed

- Documented in full under "Task 4: DEFERRED" above. Not a failure and not a skip — the
  `terraform-apply` environment's `main`-only branch policy makes it structurally impossible
  from this branch, and Kurt has decided the sequencing (infra PR → approved merge → applies
  from main).

---

## Threat Flags

None. No new security-relevant surface beyond what the plan's `<threat_model>` already
registers. Every mitigation disposition in that register is either implemented in this
commit (T-71-13-01 cache behaviour, T-71-13-02 edge block, T-71-13-03 gpx-only scoping,
T-71-13-04 cookie/header `none` plus the in-file revisit instruction, T-71-13-05 ordering
proven by line number and by the plan's block positions) or scheduled for Task 4's live
re-derivation (T-71-13-06 the Lambda invoke).

## Known Stubs

None. This plan produces no application code.

---

## Self-Check: PASSED

- `infra/terraform/modules/cloudfront/v1.0.0/main.tf` — FOUND (modified, committed)
- Commit `50efc526` — FOUND in `git log`
- CI run `30653364910` — FOUND, conclusion `success`, artifact `plan_output.txt` downloaded
  and quoted above
- `.planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-13-SUMMARY.md` —
  this file
- No local `terragrunt apply` in this plan's shell history; no `--with-terragrunt`; no PR
  merged; no AWS WAF web ACL created
