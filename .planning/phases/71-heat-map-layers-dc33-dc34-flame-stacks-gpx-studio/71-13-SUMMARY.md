---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 13
subsystem: infra
tags: [terraform, terragrunt, cloudfront, cache-policy, cloudfront-function, edge-block, blast-radius, CR-01, CR-03]
status: complete

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
  - "LIVE: repeat heat-map fetches now hit the edge 3/3 (was 0/3) — probe assertions 1 and 2 flip green"
  - "LIVE: all six gpx internal paths refused at the edge with a marked 404 and an empty body — probe assertion 8 flips green"
  - "LIVE: assertion 16's two non-gpx internal paths byte-identical to the pre-fix record — the block did not over-reach"
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
  - "71-13: the apply ran from MAIN, not the phase branch — the terraform-apply environment is main-only. An infra-ONLY PR (6 files, all under infra/) carried this plan's commit plus 71-14's three, merged --admin, and both scoped applies then ran from main. Plan from the branch, apply from main."
  - "71-13 LANDMINE: terragrunt-apply.yml's concurrency group is ${{ github.workflow }}-${{ github.ref }} with cancel-in-progress:true — two scoped applies dispatched from the SAME ref will cancel each other unless serialised. 71-13's and 71-14's applies were run one after the other on purpose."

metrics:
  duration: ~75 min
  completed: 2026-07-31
  tasks_completed: 4
  tasks_total: 4
---

# Phase 71 Plan 13: CloudFront Edge Block + Heat-Map Cache Behaviour Summary

Two new global CloudFront resources and three gpx-gated ordered cache behaviours authored
above the `/{region}/*` ALB wildcard — closing CR-03 (repeat heat-map fetches all missed the
edge) and CR-01's network half (the internal build route was reachable from the open
internet) in one file, proven confined by a CI plan of `2 to add, 1 to change, 0 to destroy`
and then re-derived live: **edge hits 3/3 (was 0/3), all six gpx internal paths refused at
the edge with a marked 404 and no body, and assertion 16's two non-gpx paths byte-identical
to their pre-fix record.**

**STATUS: COMPLETE.** Kurt approved at the Task 3b gate; the infra-only PR landed on main and
the scoped apply ran from main (`Apply complete! Resources: 2 added, 1 changed, 0 destroyed.`).
All four tasks executed. See "Task 4" below for the live evidence.

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
NO fallback collapse was applied. The apply confirmed the call — no `TooManyCacheBehaviors`;
the distribution modification completed in 48 s.** For the record, had the count reached 22 the documented
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

At the time of the plan, `gh run list --workflow=checkov-scan.yml` returned `[]` — the scan
is PR-triggered and there was no PR for this branch. The commit subsequently went to main via
infra PR #1146; **no checkov finding was reported back against the new behaviours.** Nothing
was suppressed. If a finding surfaces later it must be recorded and dispositioned, not
silenced.

---

## Task 3b: BLOCKING REVIEW — APPROVED

**Kurt approved at this gate on 2026-07-31.** The material he reviewed:

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

## Task 4: Scoped CI apply and live re-derivation — DONE

Executed by the phase orchestrator from `main` after Kurt's Task 3b approval, using the
resume commands this SUMMARY recorded at the checkpoint.

### How the change reached main

The `terraform-apply` GitHub environment has exactly one deployment-branch policy: `main`.
Plan 71-14 proved this empirically — its `terragrunt-apply.yml` dispatch from
`gsd/phase-71-heat-map-layers` failed in 2 seconds with zero steps executed:

> Branch "gsd/phase-71-heat-map-layers" is not allowed to deploy to terraform-apply due to
> environment protection rules.

`terragrunt-apply.yml`'s `workflow_dispatch` has no `ref` input (only its `workflow_call`
does), so phase-branch code cannot be applied without landing on main first.

**PR #1146** — *"infra(71): CloudFront heat-map cache policy + gpx edge block, scheduler
de-collision"*. Infra-**only**: 6 files, +346/-14, everything under `infra/`. Carried this
plan's `50efc526` plus 71-14's `d49f928d` / `f5ab57c8` / `924b0d82`, cherry-picked onto
`origin/main`. Merged **2026-07-31T18:21:43Z**, squash commit
`27422a21d0a9ad791c56160b2cbe085958d52643`.

Merged with `--admin`: main's ruleset requires one approving review plus signed commits, the
commits are unsigned, and the author cannot self-approve. Same mechanism 71-08 used. **The
merge itself was explicitly approved by Kurt at the Task 3b gate** — Essential Rule 2 is
satisfied by that approval, not bypassed by the `--admin` flag.

### The scoped apply

**Run:** https://github.com/whereiskurt/defcon.run.34/actions/runs/30654859050
**Dispatch:** `gh workflow run terragrunt-apply.yml --ref main -f modules=global/cloudfront`
**Conclusion:** success

```
aws_cloudfront_cache_policy.heatmap_artifact: Creation complete after 1s [id=f8eee9d1-3ff1-4974-a10d-0f9d9daef2e5]
aws_cloudfront_function.internal_block: Creation complete after 3s [id=dc34-gpx-internal-block]
aws_cloudfront_distribution.main["gpx"]: Modifications complete after 48s [id=E1D1R5LJNFGRLE]

Apply complete! Resources: 2 added, 1 changed, 0 destroyed.
```

**Matches the approved plan shape exactly.** No `TooManyCacheBehaviors` — the 21-of-25
headroom call held. The distribution reported `Deployed` before any probing began.

**No local `terragrunt apply` was run at any point.** The apply ran in CI; run id
`30654859050`.

### ⚠ LANDMINE for future scoped applies from the same ref

71-14's apply ran **second** (run `30655157386`, success). `terragrunt-apply.yml`'s
concurrency group is `${{ github.workflow }}-${{ github.ref }}` with
`cancel-in-progress: true`, so **two scoped applies dispatched from the same ref cancel each
other** — the second kills the first mid-flight. The two were serialised deliberately: this
plan's apply ran to completion first, then 71-14's. Anyone dispatching multiple scoped
applies from `main` must wait for each to finish, or they will silently lose one.

---

### (a) CR-03 — repeat fetches now hit the edge

Four sequential GETs of `https://gpx.defcon.run/use1/api/gpx/public/heatmap/dc33`:

```
Miss from cloudfront | 200 | 441779 bytes | cache-control: public, s-maxage=900, stale-while-revalidate=900
Hit  from cloudfront | 200 | 441779 bytes
Hit  from cloudfront | 200 | 441779 bytes
Hit  from cloudfront | 200 | 441779 bytes
```

**edge-hits 3/3.** Pre-fix this exact measurement was 4× `Miss from cloudfront`,
`edge-hits=0/3` — the CachingDisabled wildcard was swallowing the origin's `s-maxage`. The
route's `s-maxage=900` is now doing something, and the ~441 KB body is served off the edge
instead of costing the single run.gpx ECS task an S3 GetObject per anonymous hit.
**Probe assertions 1 and 2 flip green. FIXED.**

The bare artifact is 441 779 bytes and the meta projection is 87 bytes — materially
different, so the two occupy separate cache entries and the `meta` whitelist is doing its
job. Had Managed-CachingOptimized been used, these would have collided into one entry and
served each other.

### (b) CR-01 network half — all six internal paths refused at the edge

All three routes × both spellings = **6/6 blocked**, each returning:

```
HTTP 404
x-dc34-edge-block: 1
x-cache: FunctionGeneratedResponse from cloudfront
server: CloudFront
content-length: 0
```

- `/use1/api/gpx/internal/heatmap-build` · `/use1/api/gpx/internal/strava-sync` · `/use1/api/gpx/internal/reconcile`
- `/api/gpx/internal/heatmap-build` · `/api/gpx/internal/strava-sync` · `/api/gpx/internal/reconcile`

`x-cache: FunctionGeneratedResponse from cloudfront` is the positive proof the refusal came
from the CloudFront Function — the request never reached the origin, the ALB, or Next.js.
`content-length: 0` confirms no body. Pre-fix the same request returned the application's own
`{"error":"Forbidden"}` payload, which is exactly the edge-vs-app ambiguity the marker exists
to remove. **Probe assertion 8 flips green. FIXED.** The no-region spelling being blocked
confirms covering only the region-prefixed form would have left the hole open one URL to the
left.

### (c) BLAST-RADIUS REGRESSION GATE — assertion 16 STILL GREEN

GET (the probe's exact method — never POST, so no mint endpoint is poked):

```
405  x-dc34-edge-block absent  https://run.defcon.run/use1/api/internal/ctf/mint
401  x-dc34-edge-block absent  https://auth.defcon.run/use1/api/internal/quota/probe-nonexistent-user
```

**Byte-identical to 71-12's pre-fix record** (mint 405 / quota 401, neither marked). The
block did not over-reach: run.human's and run.auth's internal families are untouched, so
meshtk's ghost claim-link mint over public HTTPS (`MESHTK_RUN_INTERNAL_URL`) still works.
This was the single most dangerous way this change could have gone wrong, and it did not.

### (d) The legitimate internal caller is intact

```
aws lambda invoke --function-name heatmap-build-use1
  -> StatusCode 200, FunctionError null, 2.8 s
  {"ok":true,"year":"dc34","generatedAt":"2026-07-31T18:32:03.294Z",
   "runCount":0,"totalKm":0,"scanned":0,"skipped":0}
```

Same shape as the pre-apply baseline (200 in 2.5 s). The Lambda reaches the route at the
Cloud Map private name and never traverses CloudFront, so the edge block cannot be in its
path — but this was checked anyway because the failure mode is silent: a mistake here would
stop the heat map updating during the con with no error anywhere a user could see.
`runCount: 0` is correct and expected — no row carries a `conDay` until 2026-08-05.

---

### Observed and attributed, NOT a defect of this work: `?meta=0` still projects meta

`?meta=0` on the public route still returns the 87-byte meta projection (the bare URL returns
441 779). That is **71-10's IN-02 truthiness bug** and it is **expected to still be live** —
71-10's application code is not deployed yet. Production is still run.gpx **v0.0.109**; the
route on that build uses the old truthiness test rather than the exact `=== "1"` equality.
71-16 ships the app release that carries 71-10, and should confirm this flips.

Nothing in this plan's CloudFront work touches it. The cache policy's `meta` whitelist is
behaving correctly either way — it keys on the query string's presence and value, so once
71-10 deploys, `?meta=0` and `?meta=1` remain distinct cache entries with the corrected
semantics.

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
- **The apply was unaffected** — `terragrunt-apply.yml` DOES honour
  `modules=global/cloudfront`, confirmed by run `30654859050`, which applied that unit and
  nothing else.

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

### 3. [Sequencing, resolved] Task 4 applied from `main`, not from the phase branch

- **Found during:** Task 3b / Task 4
- **Issue:** The `terraform-apply` GitHub environment permits only `main`, and
  `terragrunt-apply.yml`'s `workflow_dispatch` has no `ref` input — so a scoped apply of
  phase-branch code is structurally impossible. 71-14 hit this first (rejected in 2 s, zero
  steps).
- **Fix:** Kurt approved at the Task 3b gate; an **infra-only** PR (#1146, 6 files, all under
  `infra/`) carried this plan's `50efc526` plus 71-14's three commits onto main and was
  merged (`27422a21`). Both scoped applies then ran from main, serialised. Task 4 executed in
  full afterwards with the results recorded above.
- **Kept as a standing rule:** plan from the branch, apply from main.

### 4. [Landmine found during Task 4] Two scoped applies from the same ref cancel each other

- **Found during:** Task 4
- **Issue:** `terragrunt-apply.yml`'s concurrency group is
  `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`. Dispatching
  71-13's and 71-14's scoped applies from `main` concurrently would have had the second kill
  the first mid-apply — on shared production infrastructure.
- **Fix:** They were run one after the other on purpose (`30654859050` then `30655157386`,
  both success). Recorded here and in this plan's key-decisions so a future multi-unit apply
  from one ref does not discover it the hard way.

---

## Threat Flags

None. No new security-relevant surface beyond what the plan's `<threat_model>` already
registers. **Every `mitigate` disposition in that register is now implemented AND re-derived
live:**

| Threat | Mitigation | Live proof |
|---|---|---|
| T-71-13-01 DoS on the uncached public artifact | dedicated cache behaviour + real policy | edge-hits 3/3, ~441 KB served off the edge |
| T-71-13-02 EoP via the internet-reachable internal build route | gpx-scoped edge behaviour, marked 404 | 6/6 refused, `FunctionGeneratedResponse`, `content-length: 0` |
| T-71-13-03 over-wide block killing meshtk's claim-link mint | gpx distribution + gpx prefix only | mint 405 / quota 401, marker absent on both — byte-identical to the pre-fix record |
| T-71-13-04 shared cache entry leaking per-user variation | cookie + header behaviour `none`, route does no session read, in-file revisit instruction | bare 441 779 B vs meta 87 B — separate entries, no per-viewer variation to leak |
| T-71-13-05 behaviours authored below the wildcard become dead code | authored above; line numbers compared | both fixes demonstrably active in production, which is only possible if the behaviours match |
| T-71-13-06 edge block covering the Lambda's Cloud Map path | structurally impossible; proven anyway | `heatmap-build-use1` → 200 in 2.8 s, `{"ok":true,...}` |

## Known Stubs

None. This plan produces no application code.

---

## Success Criteria

| Criterion | Result |
|---|---|
| Repeat fetches of the public heat-map artifact are served from the edge | **PASS** — 3/3 hits after the first miss (was 0/3) |
| The bare artifact and the meta projection occupy separate cache entries | **PASS** — 441 779 B vs 87 B |
| Every `/api/gpx/internal/*` path on the gpx host returns a marked 404 from CloudFront, region-prefixed and no-region | **PASS** — 6/6, `FunctionGeneratedResponse from cloudfront`, `content-length: 0` |
| Neither run.defcon.run's nor auth.defcon.run's internal family is affected | **PASS** — 405 / 401, marker absent on both |
| The invoker Lambda still completes a build | **PASS** — 200, `FunctionError null`, 2.8 s |
| Plan shape 2 add / 1 change / 0 destroy, human-reviewed before apply, applied in CI | **PASS** — plan `30653364910`, Kurt approved at Task 3b, apply `30654859050` |

## Self-Check: PASSED

- `infra/terraform/modules/cloudfront/v1.0.0/main.tf` — FOUND (modified, committed)
- Commit `50efc526` — FOUND in `git log`; landed on main as squash `27422a21` via PR #1146
- CI plan run `30653364910` — FOUND, conclusion `success`, artifact `plan_output.txt`
  downloaded and quoted above
- CI apply run `30654859050` — FOUND, conclusion `success`,
  `Apply complete! Resources: 2 added, 1 changed, 0 destroyed.`
- Live resources — `aws_cloudfront_cache_policy.heatmap_artifact`
  (`f8eee9d1-3ff1-4974-a10d-0f9d9daef2e5`), `aws_cloudfront_function.internal_block`
  (`dc34-gpx-internal-block`), distribution `E1D1R5LJNFGRLE` modified
- `.planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/71-13-SUMMARY.md` —
  this file
- No local `terragrunt apply` at any point; no `--with-terragrunt`; no local `--all`; no
  AWS WAF web ACL created. The one PR merge (#1146) was explicitly approved by Kurt at the
  Task 3b gate.
