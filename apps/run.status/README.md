# run.status — status.defcon.run

A **fully static** status page. No ECS, no Node runtime — just an S3 bucket behind
CloudFront. `status.defcon.run/` forwards to `/use1/` (the region prefix, matching the
rest of the platform) and serves the contents of [`site/`](./site).

## What it shows

Six services (`auth`, `cms`, `human`, `gpx`, `flash`, `bib`), each with a status dot,
release version, and a note. Three states:

| state (`status.json`) | label       | colour |
|-----------------------|-------------|--------|
| `live`                | ● stable    | 🟢 green |
| `dev`                 | ◐ active dev| 🟡 amber |
| `down`                | ○ offline   | 🔴 red  |

Region chips show which regions are deployed (`use1` live; `cac1`/`apse1` dimmed).

## Updating status (the whole point)

Everything is data-driven by two files — edit them, then run `release.sh`:

- [`site/status.json`](./site/status.json) — services, states, versions, notes, regions.
- [`site/marquee.json`](./site/marquee.json) — the scrolling ticker lines.

```bash
# edit site/status.json  (e.g. set gpx → "live", bump its version)
./release.sh                 # full publish + invalidate
./release.sh --status-only   # fast: only status.json + marquee.json
```

`release.sh` uses the **`dc34-application`** AWS profile, discovers the bucket /
distribution / prefix from SSM, syncs `site/` to `s3://<bucket>/use1/`, and invalidates
CloudFront. `status.json` is served with a short (~30s) cache so updates show quickly;
the HTML shell is cached hard.

## Easter eggs

- **Konami** (↑↑↓↓←→←→ B A) or **5 rapid taps** → Matrix mode (auto-exits after 10s).
- Exiting Matrix, typing `elkentaro`, reveals a 🎂 birthday card (swap the placeholder
  avatar via `window.__elkImg` / the card `src`, and point `ELKENTARO_URL` at the form).
- Clues are planted in the HTML source, a hidden `#ghost` block, and the devtools console.

## Infra

- Module:   `infra/terraform/modules/status-site/v1.0.0`
- Live unit: `infra/terraform/live/site/region/us-east-1/status-site`

Self-contained (own S3 + OAC + CloudFront + ACM + Route53), its own Terragrunt state
key, and it does **not** touch the shared `global/cloudfront` wiring — so it deploys
without disturbing any other service.

```bash
cd infra/terraform/live/site/region/us-east-1/status-site
terragrunt apply        # creates everything (ACM + CloudFront ≈ 5–15 min)
```
