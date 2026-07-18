# Design: `donate.defcon.run` vanity subdomain + read-only vanity panel in `/admin/qr`

**Date:** 2026-07-17
**Status:** Draft — awaiting review
**Author:** Kurt (whereiskurt@gmail.com) + Claude

## Problem

The `/admin/qr` console manages **paths under one host** (`q.defcon.run/<code>` — DynamoDB `Qr` rows, CRUD via a form). But `r.defcon.run` / `h.defcon.run` / `sao.defcon.run` are **whole subdomains**, provisioned by Terraform (`cloudfront-redirect` module driven by a `redirects.rules` list in `site.hcl`). Two systems, and the QR admin only shows one of them — so a `rick` code pointing at `https://r.defcon.run` looks like it references something configured "elsewhere," with no visibility into it.

We want two things:

1. **`donate.defcon.run`** — a real vanity subdomain that redirects to the donate flow (`https://run.defcon.run/use1/whoami?open=donate`), consistent with how `r`/`h`/`sao` work.
2. **A read-only view** of these Terraform-managed vanity subdomains inside `/admin/qr`, so all redirects — subdomains *and* `q.` codes — are visible in one place.

## Non-goals

- **No UI-driven creation/editing of subdomains.** Minting a subdomain is Route53 + CloudFront + TLS control-plane infra; it stays in Terraform. The panel is read-only.
- **No change to the `q.defcon.run` resolver or `Qr`/`Ctf` data model.** The existing `donate` QR code (`q.defcon.run/donate` → `whoami?open=donate`) is untouched and remains a separate, valid entry point.
- **No new subdomains beyond `donate`.**

## Architecture: single source of truth via `redirects.json`

Today the redirect list is an inline HCL array inside `redirects.rules` in `site.hcl`. We extract that array into one committed JSON file that **both** consumers read:

- **Terraform** (`site.hcl`) reads it with `jsondecode(file(...))` — the redirect engine, unchanged behavior.
- **run.human** (`/admin/qr`) imports it to render the read-only panel — a pure consumer.

### Where the file lives — and why

**Canonical location: `apps/run.human/webapp/src/data/redirects.json`.**

This looks backwards (infra sourcing data from an app dir), but it's forced by the deploy boundary and it's the *only* arrangement that gives true zero-drift with no sync step:

- run.human ships as a container whose Docker build context is **only** `apps/run.human/webapp`. For the panel to have the data at runtime, the file must physically live inside that context. A file in `infra/` would not be in the image.
- Terraform, by contrast, runs on a **full repo checkout** (CI uses `fetch-depth: 0`; local runs from the repo). It can read a file anywhere in the tree at plan/apply time.

So run.human owns the file's *location*; Terraform reaches up to read it in place. One committed file, both read it directly, **no copy step and no possibility of drift.**

`site.hcl` change (conceptual — exact path helper resolved in planning):

```hcl
redirects = {
  enabled = true
  rules   = jsondecode(file("${get_repo_root()}/apps/run.human/webapp/src/data/redirects.json"))
}
```

The unit-level `enabled` flag stays in `site.hcl` (it's a Terraform concern — the `exclude` block that ships the unit dark). Only the per-host **rules array** moves to JSON.

### `redirects.json` schema (unchanged from the current HCL objects)

An array of objects, each:

```jsonc
{
  "host": "r",
  "target_host": "www.youtube.com",
  "target_path": "/watch",
  "target_query": "v=dQw4w9WgXcQ",
  "status_code": 302,
  "priority": 0,               // optional
  "splash_style": "hackers",   // optional; "hackers" (default) | "countdown"
  "covert_v": null,            // optional; CTF covert beacon
  "og": {
    "title": "Run Hacker Run! — DEF CON 34 Remaster",
    "description": "...",
    "image": "...",            // optional
    "image_file": null         // optional; local PNG shipped from module assets/
  }
}
```

The extraction is a **pure refactor**: the JSON must be byte-equivalent in content to the current `r`/`h`/`sao` objects. A `terraform plan` after extraction must show **no changes** to the existing three distributions. (Landmine: preserve field order/values exactly; the module `for_each`es on `host`, so a plan diff would signal a transcription error.)

## Piece 1 — `donate.defcon.run`

Append one object to `redirects.json`:

```jsonc
{
  "host": "donate",
  "target_host": "run.defcon.run",
  "target_path": "/use1/whoami",
  "target_query": "open=donate",
  "status_code": 302,
  "og": {
    "title": "Chip In — DEF CON 34",
    "description": "Support defcon.run"
  }
}
```

- `target_path` includes the `/use1` basePath (matches the static-donate-tile landmine: hrefs into run.human need `/use1` or they 404).
- `splash_style` omitted → default `"hackers"` interstitial (OG unfurl card + ~1.6s themed splash → client-side redirect).
- `og.image` omitted initially; **follow-up:** reuse the static "Donate" tile art via `og.image_file` (a PNG in the module `assets/` dir) for a branded unfurl card.

**Result:** `donate.defcon.run` → themed splash / unfurl card → `https://run.defcon.run/use1/whoami?open=donate` → login → donate modal auto-opens (reuses the exact flow the static "Donate" tile already drives).

**No new Terraform resources** — the `cloudfront-redirect` module `for_each`es over the list and auto-creates the S3 splash object, CloudFront distribution, bucket-policy grant, and Route53 apex ALIAS for `donate`, riding the existing `*.defcon.run` wildcard ACM cert. No cert or DNS-wildcard change needed.

### Two donate entry points (intentional)

After this ships there are two paths to the same donate flow, which is fine and complementary:

- `q.defcon.run/donate` — the existing QR **code** (bare 302, for printed QR).
- `donate.defcon.run` — the new vanity **subdomain** (branded splash, for typing/sharing).

## Piece 2 — Read-only "Vanity subdomains" panel in `/admin/qr`

- A new server-rendered section on `apps/run.human/webapp/src/app/(protected)/admin/qr/page.tsx` (extract a small `VanityRedirects` component), placed near the existing "QR codes" table.
- **Data source:** static import of `src/data/redirects.json` — no new API route, no DynamoDB, no client fetch.
- **Columns:** Host (rendered as `<host>.defcon.run`), Target (`target_host` + `target_path` + `target_query`), Splash (`splash_style ?? "hackers"`). Read-only — no `edit`/`sheet` action links.
- **Label:** a clear caption — e.g. *"Terraform-managed vanity subdomains — edit `redirects.json` + apply the `redirect-rules` unit. Not editable here."* — so nobody expects a form.
- **Gate:** inherits the existing `gateAdminPage` on `/admin/qr` (bodiless 404 on denial). No new auth surface.
- **Status column:** the per-rule objects have no `enabled` field (liveness is the unit-level flag). Render a static `live` chip, or omit a status column. Decision: render `live` to match the QR table's visual rhythm.

## Data flow

```
                 apps/run.human/webapp/src/data/redirects.json   (single committed source)
                     │                                   │
   jsondecode(file)  │                                   │  import (build-time)
                     ▼                                   ▼
   site.hcl → redirects.rules              /admin/qr VanityRedirects panel
        │                                        (read-only table)
        ▼
   cloudfront-redirect module (for_each)
        → S3 splash + CloudFront distro + Route53 ALIAS  (r / h / sao / donate)
```

## Deployment (two independent surfaces)

1. **Subdomain (Piece 1):** apply the `redirect-rules` Terragrunt unit in `us-east-1`:
   `cd infra/terraform/live/site/region/us-east-1/redirect-rules && terragrunt apply`
   Needs SSO creds with the management-account Route53 role (apex zone) + site-account CF/S3. New CloudFront distro takes ~15–20 min to reach `Deployed`. The `redirects.json` refactor must land first; a plan should show **exactly one** new host (`donate`) added and no changes to `r`/`h`/`sao`.
2. **Panel (Piece 2):** a normal run.human release — `buildpub.yml` (`apps=run.human`) → `deploy.yml` (`us-east-1`). Ships the read-only panel.

The two can ship in either order (the panel just renders whatever is in `redirects.json`; the subdomain is live once Terraform applies).

## Testing

- **Refactor safety:** `terraform plan` on `redirect-rules` after extraction (before adding `donate`) shows **no changes** — proves byte-equivalent extraction.
- **CI parity guard:** a lightweight schema/shape test in run.human that asserts `redirects.json` parses and every object has the required fields (`host`, `target_host`, `target_path`, `status_code`, `og.title`) — catches a malformed hand-edit before it breaks either consumer.
- **Panel render:** unit test that the `VanityRedirects` component lists all hosts from a fixture and renders `<host>.defcon.run` + target correctly; no `edit` links present (read-only invariant).
- **Manual UAT:** after apply, hit `https://donate.defcon.run` → confirm splash → lands on `run.defcon.run/use1/whoami?open=donate` → donate modal opens. Confirm `/admin/qr` panel shows `r`/`h`/`sao`/`donate`.

## Open questions / follow-ups

- **OG card art for `donate`** — reuse the static "Donate" tile art as `og.image_file` (branded unfurl). Deferred; ships with default splash first.
- **Exact Terragrunt path helper** — `get_repo_root()` vs. a relative `${get_terragrunt_dir()}/...` — resolved during planning against how `site.hcl` locals are loaded.
