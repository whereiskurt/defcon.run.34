# sao.defcon.run — deadpan "Simple Add-On" troll redirect

**Status:** Design — approved (2026-07-11)
**Author:** KPH (with Claude)
**Scope:** One new vanity redirect host, riffing on the shipped `r./h.defcon.run` Phase 1 pattern.

---

## 1. Overview

A new vanity host **`sao.defcon.run`** that unfurls a deceptive OG card styled as a real
DEF CON badgelife **SAO ("Simple Add-On" / "Shitty Add-On")** electronic badge, then — after a
themed **5-second boot-sequence countdown** — 302-redirects to **`bib.defcon.run`**.

The troll: people (and link unfurls in Signal/Discord/Slack) read it as an *electronic* add-on
that "pairs with your Meshtastic node." It is actually the **run bib** — a paper number you
safety-pin on. The bib *is* the "simple add-on." The reveal is deliberately withheld from the
card and only lands when the countdown drops the visitor on `bib.defcon.run`.

This reuses the existing `cloudfront-redirect` module wholesale (private S3 interstitial page +
per-host CloudFront distro + apex Route53 alias). No new infra primitives.

## 2. Goals / Non-goals

**Goals**
- A believable electronic-SAO unfurl card (`sao.png`, 1200×630) — deadpan, no visible "bib" punchline.
- A 5-second electronic boot-sequence splash with a visible countdown, then redirect to `bib.defcon.run`.
- Ship via the same CI path as r./h. (`terragrunt-apply.yml`, us-east-1, `redirect-rules`). No local applies.
- **Zero regression risk** to the live `r./h.` interstitial pages.

**Non-goals (YAGNI)**
- No changes to the resolver / q. service (unrelated future phases).
- No new CloudFront/ALB primitives — just one more entry in the existing `redirects.rules` list.
- No dynamic behavior; this is a static edge card + client redirect, same as r./h.

## 3. SAO grounding (why the deadpan copy works)

The Shitty/Simple Add-On standard (badgelife, 2018; v1.69bis / "SAO.69") is real, and its own
spec sheet is deadpan-absurd — which makes authentic-sounding copy *more* convincing to the
DEF CON audience, not less:
- 6-pin **2×3 shrouded I²C header** (GND, 3.3 V, SDA, SCL + 2 GPIO).
- Documented max power draw: **1.1 millihorsepower**; GPIO through ≥330 Ω; signals ≤3.6 V.
- Rebranded "Simple Add-On" for accessibility; everyone still knows it as Shitty Add-On.

Sources: [Hackaday — Shitty Add-On V1.69bis](https://hackaday.com/2019/03/20/introducing-the-shitty-add-on-v1-69bis-standard/),
[Hackaday.io — Simple Add-ons (SAO)](https://hackaday.io/project/175182-simple-add-ons-sao).

## 4. The unfurl card — `assets/sao-card.src.html` → `assets/sao.png` (1200×630)

**Aesthetic:** a PCB fab datasheet. Dark soldermask green (`#0a2a1a`), gold/copper trace routing,
white silkscreen text, corner fiducials + drill holes, FR4 fiberglass edge. Reads as a real
badge drop.

**Elements & copy (deadpan — the word "bib" never appears):**
- Corner silkscreen: `DEF CON 34 · BADGELIFE`, part no. `DC34-SAO-01`, `REV 1.69bis`.
- Copper-etched **bunny** (reuse `bunny-head.png`, gold-toned via CSS filter) + a **DC34** mark +
  a silkscreened **Meshtastic** logo (sourced from repo meshmap assets if present, else recreated as SVG).
- Title `SIMPLE ADD-ON` + a `v1.69bis` chip.
- Tagline `PAIRS WITH YOUR MESHTASTIC® NODE`.
- Deadpan spec table (authentic SAO lore, nothing that says "bib"):
  - INTERFACE — I²C · SAO 6-pin (2×3 shrouded)
  - PWR DRAW — 1.1 millihorsepower @ 3.3 V
  - ADDR — 0x69
  - RANGE — line-of-sight · Las Vegas
  - INCLUDED — 1 per DC34 run kit
- Footer: `sao.defcon.run` · fake `FCC ID: 2ADC34-RUN` · `RoHS · lead-free · sweat-resistant`.

The only breadcrumb is "1 per DC34 run kit" — ambiguous (reads as a hardware bundle). The
render is produced by opening `sao-card.src.html` in a headless browser at 1200×630 and
screenshotting, exactly as `hackers.png` was produced. Both files are committed.

## 5. The interstitial splash — `assets/interstitial-countdown.html.tftpl`

Approach **A (chosen): a second template.** The existing `interstitial.html.tftpl` (hardcoded
HACKERS theme, shared by live r./h.) is left **byte-identical and untouched** — guaranteeing no
regression. The module selects the template per rule via a new optional `splash_style` field
(`"hackers"` default → existing template; `"countdown"` → the new template).

New template behavior (electronic boot vibe):
- Title `SIMPLE ADD-ON` / `SAO · DC34`.
- Terminal lines: `i2c: probing 0x69 … device found` → `meshtastic: pairing node …` → `mounting add-on …`.
- **Visible countdown `5 · 4 · 3 · 2 · 1`** with a progress bar filling over 5 s.
- `skip ›` link (as hackers has) for the impatient.
- `prefers-reduced-motion` fallback jumps the bar to full and skips the animation.
- JS `location.replace(target)` fires at 5 s. No-JS `<meta http-equiv="refresh">` fallback set to
  ~6 s so it never preempts the JS countdown.
- Same OG meta block as the existing template (title/description/image, twitter card) so the
  unfurl is identical to how r./h. behave.

## 6. Module change (small)

In `modules/cloudfront-redirect/v1.0.0/main.tf`, the `local.html` map picks the template file by
`try(r.splash_style, "hackers")`:
- `"hackers"` → `assets/interstitial.html.tftpl` (unchanged).
- `"countdown"` → `assets/interstitial-countdown.html.tftpl`.

Everything else (S3 object, image upload, CloudFront distro, bucket policy, Route53 alias) is
already `for_each` over `redirect_map` — adding the `sao` rule fans out automatically. No new
resources authored.

## 7. Wiring — `site.hcl` `redirects.rules`

Append one rule:
```hcl
{
  host         = "sao"
  target_host  = "bib.defcon.run"
  target_path  = "/"
  target_query = ""
  status_code  = "HTTP_302"
  priority     = 92
  splash_style = "countdown"
  og = {
    title       = "DC34-SAO-01 — Simple Add-On (v1.69bis)"
    description = "The DEF CON 34 SAO that pairs with your Meshtastic node. I²C, 1.1 millihorsepower, 1 per run kit."
    image       = "https://sao.defcon.run/sao.png"
    image_file  = "sao.png"
  }
}
```
`bib.defcon.run` already serves HTTP 200 (verified) — valid redirect target.

## 8. Testing / verification

- **Local render check:** open `sao-card.src.html` at 1200×630, screenshot, eyeball `sao.png`.
- **templatefile harness:** the new template must survive `terraform templatefile()` — escape any
  literal `%{` in CSS keyframes as `%%{` (the landmine that bit #500). Verify with a throwaway
  `terraform ... templatefile()` render before pushing.
- **CI plan:** `terragrunt-plan.yml` (us-east-1, redirect-rules) — expect **only** additive changes
  for `sao` (new S3 objects, distro, alias) and **no changes** to r./h. resources. Any r./h. diff =
  stop (means the shared template regressed).
- **Post-apply live check:** `curl https://sao.defcon.run/` → 200 interstitial with SAO OG tags;
  confirm the page redirects to `bib.defcon.run` after the countdown; confirm the unfurl image
  resolves at `https://sao.defcon.run/sao.png`.

## 9. Rollout

1. Build + render the poster; get visual sign-off (the "sketch one up like hackers" step).
2. Add the countdown template + module `splash_style` switch + `site.hcl` rule.
3. PR → merge to main → `terragrunt-apply.yml` (us-east-1, redirect-rules).
4. Live-verify per §8. `redirects.enabled` is already `true`.
