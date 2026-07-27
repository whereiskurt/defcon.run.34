# p.defcon.run + g.defcon.run vanity domains — design

Date: 2026-07-26 · Approved by Kurt in-session

## Goal

Two new vanity subdomains with full OG-unfurl treatment, following the exact
r./h./sao./donate./b./f. pattern (closest template: PR #829, f.defcon.run):

- **p.defcon.run** — phreaking / "make a call" theme → `https://q.defcon.run/p`
- **g.defcon.run** — purple ghost matrix theme → `https://q.defcon.run/g`

Both resolver codes point at the rickroll
(`https://www.youtube.com/watch?v=dQw4w9WgXcQ`) for now; retargetable any time
from `/admin/qr` with no terraform.

## Changes

1. **`apps/run.human/webapp/src/data/redirects.json`** — records `p`
   (priority 96, `splash_style: "phone"`) and `g` (priority 97,
   `splash_style: "ghost"`), HTTP_302, targets `q.defcon.run/p` and `/g`.
   The existing `cloudfront-redirect` module `for_each` generates the S3
   interstitial, per-host CloudFront distribution, and Route53 alias.
   Certs ride the `*.defcon.run` wildcard SAN — no cert work.

2. **`infra/terraform/modules/cloudfront-redirect/v1.0.0`**
   - `assets/interstitial-phone.html.tftpl` — DTMF keypad auto-dial splash
     ("DIALING…", 2600 Hz chip, Bell-blue on the site's `#0a0a0f` base).
   - `assets/interstitial-ghost.html.tftpl` — purple matrix-rain canvas splash
     ("SUMMONING…", ghost glyphs in the rain).
   - `main.tf` `splash_tpl_by_style` += `phone`, `ghost`; `variables.tf` doc
     comment updated.
   - `assets/phone-card.src.html` + rendered `phone-card.png` (1200×630) —
     payphone/blue-box unfurl card. OG: **"Make a Call — DEF CON 34"** /
     "Drop a quarter, whistle 2600 Hz, and seize the trunk…"
   - `assets/ghost-card.src.html` + rendered `ghost-card.png` (1200×630) —
     purple ghost matrix card. OG: **"The Ghosts — DEF CON 34"** /
     "Something haunts the DEF CON 34 mesh…"
   - Render recipe (committed in each src.html): headless Chrome,
     `--force-device-scale-factor=1 --window-size=1200,630`.

3. **`apps/run.human/webapp/scripts/seed-vanity-pg-qr.mts`** — idempotent,
   dry-run by default; creates resolver codes `p` and `g` → rickroll.
   MUST run `--apply` BEFORE the redirect-rules terraform apply or the vanity
   hosts 404. Entity shape mirrored (qr-key-parity guarded) like the b./f.
   seeds.

4. **Tests** — `vanity-redirects.test.ts`: host order gains `p`, `g`; resolver
   targets asserted; splash known-set gains `phone`, `ghost`.

## Terraform templatefile landmines (carried from flash splash)

`%` immediately followed by `{` is a directive — no CSS `50%{}` keyframe
selectors (use from/to or double the percent); no literal `${` in JS (use the
provided `target_url_json` var).

## Rollout

Merge PR → seed `--apply` (SSO `dc34-application`) → terraform apply
`redirect-rules` region us-east-1 (CI plan/apply path, scoped modules) →
verify: `curl -s https://p.defcon.run/ | grep og:` + real chat-app paste.
