# DEPLOY-SPEC — CTF-12 covert-path CloudFront behavior (`/use1/assets/theme`)

**Status:** AUTHORED + `terraform validate`-clean. **NOT APPLIED.**
**Apply + curl verification below are a deliberate human follow-up performed under review — this phase did not run `terragrunt plan`/`apply` and made no live AWS/curl call.**

This spec is paired with the HCL edit in `main.tf` because two properties the covert
channel depends on are **runtime** facts that `terraform validate` cannot prove:

1. **Behavior precedence** — CloudFront picks the first path-pattern match in list order.
2. **Blast radius** — this one module (`aws_cloudfront_distribution.main`, `for_each = local.domain_set`)
   renders **all six production distributions**: `auth / run / cms / gpx / flash / bib`.

A human applies this deliberately and confirms both with the plan-diff + curl matrix here.

---

## 1. What changed

A single run-domain-gated ordered cache behavior on the **run.defcon.run** distribution:

| Field | Value |
|-------|-------|
| Gate | `for_each = each.key == "run" ? toset(["theme"]) : toset([])` (run distro only) |
| `path_pattern` | `/use1/assets/theme` (exact, **extension-less** — no `*` wildcard) |
| `target_origin_id` | `alb-use1` (run.human app/ALB origin — **NOT** the S3 `s3-use1` assets origin) |
| `viewer_protocol_policy` | `redirect-to-https` |
| `allowed_methods` | `["GET", "HEAD", "OPTIONS"]` |
| `cached_methods` | `["GET", "HEAD"]` |
| `compress` | `true` |
| `cache_policy_id` | `4135ea2d-6df8-44a3-9df3-4b5a84be39ad` — **Managed-CachingDisabled** |
| `origin_request_policy_id` | `216adef6-5c7f-47e4-b989-5492eafa07d3` — **Managed-AllViewerExceptHostHeader** |
| response headers policy | none |
| CloudFront function | none |

**Why these policies:**
- **CachingDisabled** — every covert hit must reach the app so per-request, auth-state-bearing
  CSS (the award marker) renders. Caching would serve one player's response to all viewers
  (information disclosure — T-48-01).
- **AllViewerExceptHostHeader** — forwards the `.defcon.run` session cookie + query string
  (`?v=<encoded guess>`) while rewriting `Host` to the ALB, exactly as the existing app
  behaviors do. Without cookie forwarding the app can't determine sign-in state.

The covert request in practice is `GET /use1/assets/theme?v=<urlencoded value>`. CloudFront
path-pattern matching ignores the query string, so the exact pattern `/use1/assets/theme`
matches regardless of `?v=`.

---

## 2. Ordering requirement (LOAD-BEARING)

The new behavior is authored **textually BEFORE** the dynamic `/{region}/assets/*` S3 wildcard
block in `main.tf`. CloudFront evaluates ordered behaviors in list order and serves the **first**
path-pattern match.

- **Correct (as authored):** `/use1/assets/theme` (exact) precedes `/use1/assets/*` (wildcard)
  → the covert request lands on `alb-use1`, uncached, cookie forwarded. ✅
- **If mis-ordered:** the `/use1/assets/*` S3 wildcard would grab `/use1/assets/theme` first
  → served from the S3 static bucket, **cached**, **no cookie** → the covert channel is dead
  (wrong origin, no auth signal). ❌ (T-48-02)

**Confirm in the plan diff:** the added behavior for the `run` distribution appears at a lower
ordinal than the `s3-use1` `/use1/assets/*` behavior. In the rendered distribution the exact
path must precede the wildcard.

---

## 3. Blast-radius check (six-distro shared module)

Before apply, run a plan and confirm the change is **scoped to the `run` distribution only**:

```bash
cd infra/terraform/live/site/global/cloudfront
terragrunt plan
```

**PASS criteria — the diff must show:**
- `aws_cloudfront_distribution.main["run"]`: exactly **one added** `ordered_cache_behavior`
  (`path_pattern = "/use1/assets/theme"`, `target_origin_id = "alb-use1"`, the two managed
  policy IDs above), and **no** change to its origins, other behaviors, or the default behavior.
- `aws_cloudfront_distribution.main["auth" | "cms" | "gpx" | "flash" | "bib"]`: **no changes**.
- No origin additions/removals, no policy changes, no OAC / bucket-policy changes anywhere.

If the plan shows changes to any distro other than `run`, or origin/policy churn — **STOP**,
do not apply, investigate.

---

## 4. Apply (human, under review)

CloudFront is a global service; this is the global unit.

```bash
cd infra/terraform/live/site/global/cloudfront
terragrunt apply
```

Note: CloudFront distribution updates take **~5–15 minutes** to propagate to all edges after
apply reports success. Wait for propagation before running the curl matrix.

---

## 5. Curl verification matrix

Target: `https://run.defcon.run/use1/assets/theme` (add `?v=<encoded guess>` per outcome).

For each row confirm the response reaches the **app origin** and is **uncached** with the
**cookie forwarded**:

- **Origin = app (not S3):** body is app-rendered CSS, `Content-Type: text/css`. An S3 static
  file would carry S3/`CachingOptimized` cache headers instead.
- **Uncached:** repeated hits show `X-Cache: Miss from cloudfront` (never `Hit`), and the app
  emits `Cache-Control: no-store` (or equivalent no-cache). CachingDisabled forwards every hit.
- **Cookie forwarded:** signed-in vs anonymous requests produce **different bodies** (award
  marker present only when the forwarded `.defcon.run` session cookie authenticates the viewer).

| # | State | Request | Expected |
|---|-------|---------|----------|
| 1 | Not signed in | `curl -sSI https://run.defcon.run/use1/assets/theme?v=<any>` | `200`, `Content-Type: text/css`, `X-Cache: Miss from cloudfront`, no-store; decoy body (no award marker) |
| 2 | Signed in, **wrong** guess | `curl` with `-b "<.defcon.run session cookie>"`, `?v=<wrong>` | `200 text/css`, uncached; decoy body (no award marker) — indistinguishable status/headers/size |
| 3 | Signed in, **correct** guess | `curl` with cookie, `?v=<correct>` | `200 text/css`, uncached; body differs from #1/#2 **only** in the award marker (e.g. `:root{--accent-ramp: <points>}`) |
| 4 | Cache probe | repeat #3 twice | both `X-Cache: Miss from cloudfront` (no caching of the per-user response) |

Pass = origin is the app (uncached, cookie-forwarded), and the CSS bodies differ **only** in the
award marker across win / wrong / not-signed-in — status, `Content-Type`, and near-size are
uniform (covert invisibility, spec §7.2 / §10).

To get a signed-in cookie for #2/#3, sign in at `run.defcon.run` in a browser and copy the
`.defcon.run` session cookie into `-b`, or use an existing authenticated E2E session.

---

## 6. Rollback

Remove the gated `ordered_cache_behavior` block (the `each.key == "run" ? toset(["theme"]) : toset([])`
one) from `infra/terraform/modules/cloudfront/v1.0.0/main.tf` and re-apply:

```bash
cd infra/terraform/live/site/global/cloudfront
terragrunt apply
```

The run distribution reverts to routing `/use1/assets/theme` through the `/use1/assets/*` S3
wildcard (its pre-CTF-12 behavior). No other distro is affected.
