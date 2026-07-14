# DEPLOY-SPEC — CTF-13: `q.defcon.run/admin/*` → run.human admin CTF leaderboard

**Status:** AUTHORED + `terraform validate`-clean + `fmt`-clean. **NOT applied. NOT enabled.**
**Requirement:** CTF-13 (Phase 48). **Design:** `docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md` §8.2, §9 item 2, §12.
**Apply unit:** `infra/terraform/live/site/region/us-east-1/qr-resolver/`

This spec exists because the routing that makes `q.defcon.run/admin/leaderboard`
actually render is a **runtime property `terraform validate` cannot prove** (Host
resolution + the `/use1` basePath prefix), and because the q resolver distro is
gated behind `enable_transport` (default false) which **must not be flipped
blind**. The HCL is committed inert; a human applies + verifies deliberately using
this checklist.

---

## 1. What was authored (inert, committed)

In `infra/terraform/modules/qr-resolver/v1.0.0/`:

- **`variables.tf`** — new `run_human_origin_domain` (string, default
  `"run.defcon.run"`; only used when `enable_transport = true`).
- **`transport.tf`**, inside `aws_cloudfront_distribution.resolver`
  (`count = var.enable_transport ? 1 : 0` — **gate unchanged**):
  - a second **`origin`** `origin_id = "alb-run-human"`,
    `domain_name = var.run_human_origin_domain`, `custom_origin_config`
    mirroring `alb-resolver` (http 80 / https 443, `origin_protocol_policy =
    "https-only"`, `origin_ssl_protocols = ["TLSv1.2"]`), same
    `X-Origin-Region = var.region.label` custom header;
  - an **`ordered_cache_behavior`** `path_pattern = "/admin/*"`,
    `target_origin_id = "alb-run-human"`, `viewer_protocol_policy =
    "redirect-to-https"`, methods `GET/HEAD/OPTIONS` (cache `GET/HEAD`),
    `cache_policy_id = 4135ea2d-6df8-44a3-9df3-4b5a84be39ad`
    (**Managed-CachingDisabled**), `origin_request_policy_id =
    216adef6-5c7f-47e4-b989-5492eafa07d3`
    (**Managed-AllViewerExceptHostHeader**).

**The `default_cache_behavior` (resolver Lambda scan path) is UNTOUCHED** and
stays the fallthrough. The `/admin/*` behavior sits **above** it in ordering.
Because the whole distro rides `enable_transport` (default **false**), this
addition is **INERT** — it renders nothing until a human enables transport and
applies. No CloudFront rewrite function was added (see §2b — its necessity/shape
is apply-tested, not guessed into live-critical HCL).

---

## 2. The runtime-decided routing (apply-tested — the reason this spec exists)

Goal: `q.defcon.run/admin/leaderboard` must reach run.human as
**`run.defcon.run/use1/admin/leaderboard`** (run.human's Next.js `basePath` is
`/use1`, and its admin routes live under `ADMIN_GROUPS`). Two independent
unknowns:

### 2a. Host — which origin so the ALB routes to run.human

Candidate mechanisms, in the order to apply-test:

- **(a) — AUTHORED DEFAULT.** Origin = the **run.defcon.run public front door**
  (`run_human_origin_domain = "run.defcon.run"`). Host resolves to run.human via
  run.human's own CloudFront distro; run.human then serves the admin route. This
  is the simplest, most decoupled option and is what ships in the HCL.
  - Risk to check on apply: nested-CloudFront / redirect loops, and whether the
    run.human front door honors the forwarded Host + cookie for `/admin/*`.
- **(b) — FALLBACK.** Origin = the **shared `alb_dns_name`** with a **forced
  Host** (e.g. an `X-Forwarded-Host` / origin custom header, or a custom-origin
  Host override) so the ALB's existing run.human `host_header` listener rule
  matches. Use this only if (a) does not land on the `/use1` app behavior.
  - To switch: set `run_human_origin_domain = var.alb_dns_name` and add the
    Host-forcing header. Same way the resolver's own `alb-resolver` origin +
    `host_header = q.defcon.run` listener rule route q. off the shared ALB.

**Either way the auth gate still runs** (§3): a wrong Host yields a 404 / wrong
app, **never an auth bypass** — run.human's `ADMIN_GROUPS` gate runs on whatever
it serves (threat T-48-06).

### 2b. basePath — the `/use1` prefix

run.human is served under `basePath = /use1`. `q.defcon.run/admin/leaderboard`
carries **no** `/use1`. On apply, check whether the chosen origin already lands
on the `/use1/*` app behavior (e.g. the front door rewrites, or the ALB rule is
path-agnostic):

- **If the origin already reaches `/use1/admin/leaderboard`:** nothing to add.
- **If it 404s for lack of `/use1`:** add a **CloudFront viewer-request
  function** on the `/admin/*` behavior rewriting `/admin/*` → `/use1/admin/*`.
  Add it **only if apply-tested as necessary** — do not pre-commit it.

---

## 3. Cookie / `ADMIN_GROUPS` gate (authorization lives in run.human, not here)

The `/admin/*` behavior uses **Managed-AllViewerExceptHostHeader**, so the
`.defcon.run` **session cookie is forwarded** (same-site). Authorization is
entirely run.human's existing `ADMIN_GROUPS` gate (`admin | runadmin`). Verify:

- **admin session** → the CTF leaderboard renders.
- **non-admin session** → run.human's **access-denied** (NOT the leaderboard).
- **anon (no session)** → run.human's **sign-in redirect**.

The CloudFront behavior only routes + forwards the cookie; it makes no auth
decision (threat T-48-05).

---

## 4. Prerequisites & ordering

1. `enable_transport = true` on the qr-resolver unit **AND** the q front door
   (CloudFront distro + ACM cert + `q.defcon.run` ALIAS + ALB listener rule)
   must already exist — see the transport.tf header (Decision 1 = A). Do not flip
   `enable_transport` until that front door exists or q. is unreachable.
2. The `/admin/*` ordered behavior sits **above** the default resolver (scan)
   behavior, which stays the fallthrough.
3. run.human's Phase-47 admin CTF leaderboard route must be deployed.

---

## 5. Apply (deliberate human follow-up — NOT performed in this phase)

```
cd infra/terraform/live/site/region/us-east-1/qr-resolver
terragrunt apply
```

Then wait for CloudFront propagation (distribution `Deployed`, typically a few
minutes).

---

## 6. Verification (curl / browser — after apply)

- **Admin:** `q.defcon.run/admin/leaderboard` as an `admin`/`runadmin` session →
  renders the CTF leaderboard.
- **Non-admin:** same URL, non-admin session → run.human access-denied.
- **Anon:** same URL, no session → sign-in redirect.
- **No caching:** repeated admin loads are never a stale/other-admin body
  (Managed-CachingDisabled; check `x-cache: Miss from cloudfront`).
- **Scans still work (default behavior intact):** `q.defcon.run/<code>` still
  `302`s via the resolver Lambda — the `/admin/*` behavior did not steal the
  scan path.

---

## 7. Rollback

- Remove the `/admin/*` `ordered_cache_behavior` + the `alb-run-human` origin
  and `terragrunt apply`; **or**
- Leave `enable_transport = false` (the whole distro, including this behavior,
  stays inert).

Either fully reverts CTF-13 with no effect on the resolver scan path.
