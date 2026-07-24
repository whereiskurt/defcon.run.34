# AGENTS.md — run.flash firmware versions & app downloads

How the multi-firmware picker works and the exact recipes for the asks that
recur: "get the latest 2.8 nightly", "promote 2.8 to stable", "change an APK".

## How versions work (30 seconds)

Two checked-in config files at `webapp/` drive Docker Stage 1
(`webapp/Dockerfile.webapp`):

- **`firmware-versions.json`** — the three picker slots:
  - `stable` (pinned, `default: true`) and `previous` (pinned): downloaded as
    GitHub release arch zips (`esp32 esp32s3 esp32c3 esp32c6 nrf52840 rp2040`).
  - `nightly` (`pin: ""`): resolved **at image build time** from
    `meshtastic.github.io/firmware-nightly/index.json` (the develop build,
    same rolling folder the official flasher uses), fetched per-target.
- **`app-downloads.sources.json`** — the two mirrored Android APKs (the ONLY
  place GitHub URLs may live; runtime manifests are URL-stripped).

Stage 1 writes resolved manifests over the tracked snapshots
`webapp/public/data/firmware-manifest.json` / `apps-manifest.json`; the client
statically imports those (no runtime fetch, offline gate DPLY-06 intact).
`NEXT_PUBLIC_FIRMWARE_VERSION` = the default slot's version.

## "Get the latest nightly 2.8" (daily-ish refresh)

**Edit nothing.** The nightly slot re-resolves every image build, so a refresh
is just a re-release of run.flash:

```bash
cp <main-checkout>/env.local.sh <worktree-root>/env.local.sh   # worktree landmine
./apps/release-all.sh --apps run.flash --pr
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=<ReleasePR#> -f invalidate_cache=true
gh run watch <run-id>
```

Verify which nightly got baked:

```bash
curl -s https://flash.defcon.run/use1/assets/public/data/firmware-manifest.json | jq '.versions'
```

Notes:
- The baked nightly is **frozen per release** — it only advances when you
  re-release. That's deliberate (self-hosted, con-network-proof).
- Nightlies **cannot be re-pinned later**: the upstream folder holds only the
  current build. What the manifest recorded is what you have.
- ~10-12 fringe targets are missing upstream per nightly — build warns and
  continues; the Flash step shows a clean 404 error if a user picks one.

## "2.8 released — make it stable"

When a real `v2.8.x` GitHub release exists (check
`https://api.meshtastic.org/github/firmware/list` → `releases.stable[0]`),
edit `webapp/firmware-versions.json` — e.g. promote and demote:

```json
{ "slot": "stable",   "pin": "2.8.0.<hash>",    "label": "2.8.0 — recommended", "default": true },
{ "slot": "previous", "pin": "2.7.26.54e0d8d",  "label": "2.7.26 — previous stable" },
{ "slot": "nightly",  "pin": "", "label": "2.9 nightly — experimental", "experimental": true }
```

Then: mirror the same values into `webapp/public/data/firmware-manifest.json`
(the tracked snapshot — keep field shape `slot/version/label/default/experimental`),
run `npx vitest run` in `webapp/` (validates exactly-one-default etc.),
PR → merge → release + deploy as above.

## Changing the mirrored APKs

Edit `webapp/app-downloads.sources.json` (URL + filename + labels), mirror the
URL-stripped entries into `webapp/public/data/apps-manifest.json`, vitest, PR,
release. **Meshtastic-Android tags need the `v` prefix** (`v2.8.0-open.1`);
older releases use different asset names (2.7.13 = `app-fdroid-release.apk`).
Build hard-fails on a bad APK URL — that's intentional; these links are
load-bearing at con.

## Landmines (all hit for real)

- **Firmware ≤2.7.15 has NO `.factory.bin` anywhere** (predates the factory
  image convention) — such a pin can't flash ESP32. The build guard rejects
  any pinned slot yielding zero factory.bin; don't weaken it.
- **release-all exits 1 at ca-central-1** ("dc34-run-flash-nginx does not
  exist") — **benign**, flash is use1-only. use1 build+push+S3 completes
  first. Check for the Release PR + "Image successfully pushed ...us-east-1"
  lines instead of trusting the exit code.
- ECR is immutable — never `--skip-bump`; every release needs the new VERSION.
- Local dev parity scripts: `webapp/scripts/download-firmware.sh` (all slots),
  `download-apps.sh`, `generate-hardware-list.sh` — keep their arch lists in
  lockstep with the Dockerfile if you touch either.

## Verify after deploy (one per slot + APKs)

```bash
V=$(curl -s https://flash.defcon.run/use1/assets/public/data/firmware-manifest.json | jq -r '.versions[].version')
for v in $V; do curl -sI -o /dev/null -w "tbeam $v: %{http_code}\n" "https://flash.defcon.run/use1/assets/public/firmware/firmware-tbeam-$v.factory.bin"; done
curl -sI -o /dev/null -w 'apk 2.7.13: %{http_code}\n' https://flash.defcon.run/use1/assets/public/apps/meshtastic-android-2.7.13.apk
```

(Expect 200s; a `tbeam` 404 for the nightly slot only means that target was
missing upstream that day — spot-check `heltec-v3` instead.)
