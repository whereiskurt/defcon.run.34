---
phase: 18
plan: 02
phase_name: Build-Time Firmware & Device List Refresh
plan_name: Local-Dev Scripts (dev/prod parity)
date: 2026-07-01
status: complete
---

# 18-02 Summary — Local-Dev Scripts

Brought `apps/run.flash/webapp/scripts/` in lockstep with the Dockerfile
behavior 18-03 will codify: same version-resolution path, same
factory-image extraction, same ESP32-only hardware filter.

## Tasks completed

| # | Task | Commit |
|---|------|--------|
| 1 | Update `download-firmware.sh` — API-resolve default, extract `.factory.bin`, write `.env.local` | `c9bc7e67` |
| 2 | Add `generate-hardware-list.sh` — ESP32-only hardware list regenerator | `03416de7` |

## Files created

- `apps/run.flash/webapp/scripts/generate-hardware-list.sh` (new, executable)

## Files modified

- `apps/run.flash/webapp/scripts/download-firmware.sh`

## Invariants delivered

- `download-firmware.sh` accepts an explicit version arg **or** resolves
  `releases.stable[0].id` from `api.meshtastic.org/github/firmware/list`
  (matches Dockerfile Decision 2 — no hardcoded fallback).
- `download-firmware.sh` extracts `firmware-{target}-{version}.factory.bin`
  (bootable at `0x00`, per FLSH-08 / Decision 1). `*-update.bin` sweep
  retained as defense-in-depth.
- `download-firmware.sh` idempotently writes
  `NEXT_PUBLIC_FIRMWARE_VERSION=<resolved>` into
  `apps/run.flash/webapp/.env.local` (grep -v the existing line, append,
  atomic mv) so `next dev` sees the resolved version without any source
  edits (FLSH-07 / Decision 3).
- `generate-hardware-list.sh` fetches
  `api.meshtastic.org/resource/deviceHardware`, `jq`-filters to
  `architecture ∈ {esp32, esp32-s3, esp32-c3, esp32-c6}`, validates
  non-empty, and atomically overwrites
  `apps/run.flash/webapp/public/data/hardware-list.json` (DEVC-06 /
  Decision 4).
- Both scripts fail fast on non-2xx HTTP (`curl -fsSL` / `curl -fL`)
  rather than silently producing empty/stale output.

## Deviations from plan

None. Both tasks executed as written. Minor implementation choice: the
`grep -v` line in the `.env.local` writer is followed by ` || true` to
tolerate a fresh (empty) file where `grep -v` would otherwise exit 1
under `set -e` when it matches zero lines. This preserves the
"idempotent" contract without regressing the fail-fast posture on
network calls.

## Known issues

None. Scripts are standalone; verifying end-to-end (actual `curl` +
`unzip` + real ESP32 boot) is deferred to 18-03 (Dockerfile stage
rewrite) and the FLSH-08 hardware boot check called out in the phase
context. This plan (18-02) intentionally covers scripts only — no
source-code or `package.json` changes, as scoped.

## Next

Proceed to 18-03: rewrite `Dockerfile.webapp` Stage 1 to use the same
API-resolve + `.factory.bin` + `NEXT_PUBLIC_FIRMWARE_VERSION` pattern,
and add the parallel hardware-list build stage.
