---
phase: 18
phase_name: Build-Time Firmware & Device List Refresh
milestone: v1.4
date: 2026-07-01
status: context-captured
mode: headless-autonomous
requirements: [FLSH-06, FLSH-07, FLSH-08, DEVC-06, DPLY-06]
---

# Phase 18 Context: Build-Time Firmware & Device List Refresh

## Domain

At Docker-build time (no code edits, no manual pin), the flasher image auto-resolves the current Meshtastic **stable** release, vendors the correct **bootable factory image** for each ESP32 family, and regenerates the ESP32-only device list — surfacing the resolved version as the single source of truth in the UI, while preserving the zero-runtime-dependency (offline-at-event) guarantee.

**Only implementation decisions are captured here — WHAT/WHY are locked by ROADMAP.md success criteria and REQUIREMENTS.md (FLSH-06/07/08, DEVC-06, DPLY-06). Anything about branding, dependency bumps, or connect/error UX belongs in Phase 19.**

## Canonical refs (agents MUST read before planning)

- `.planning/ROADMAP.md` — Phase 18 goal + success criteria (authoritative WHAT).
- `.planning/REQUIREMENTS.md` — FLSH-06, FLSH-07, FLSH-08, DEVC-06, DPLY-06 (authoritative requirement text).
- `apps/run.flash/webapp/Dockerfile.webapp` — current firmware download stage (Stage 1) that must be rewritten to resolve latest-stable + vendor factory images.
- `apps/run.flash/webapp/src/config/firmware.ts` — currently holds hardcoded `FIRMWARE_VERSION`; must become build-injected.
- `apps/run.flash/webapp/src/config/devices.ts` — `RECOMMENDED_SLUGS` set (must be preserved and sorted first after list regeneration).
- `apps/run.flash/webapp/scripts/download-firmware.sh` — local-dev download flow; must move to `.factory.bin` in lockstep with the Dockerfile stage.
- `apps/run.flash/webapp/src/hooks/use-flash.ts` — flash pipeline writes to `0x0` (line 98), reads MD5 at `0x0` (line 135); factory-image switch must be validated against this offset.
- `apps/run.flash/webapp/public/data/hardware-list.json` — tracked in git today; will be regenerated at build.
- Meshtastic APIs (build-time only, never runtime):
  - `https://api.meshtastic.org/github/firmware/list` — read `releases.stable[0]` for version resolution (FLSH-06).
  - `https://api.meshtastic.org/resource/deviceHardware` — read for hardware list (DEVC-06).

## Carrying forward from earlier phases

- **[v1.4 milestone decision]** Latest-stable firmware resolved at **build time only** (never runtime) — preserves the zero-runtime-dependency guarantee established in v1.0. This is non-negotiable and shapes every gray area below.
- **[v1.4 milestone decision]** No firmware version picker in UI — one auto-tracked stable build. Supersedes the v1.0 out-of-scope note. The UI shows the resolved version as read-only text.
- **[v1.0]** Firmware binaries are baked into the Docker image (extracted to S3 via `build.sh`, served via CloudFront asset prefix). This asset-prefix pattern is preserved — factory-image switch is a content change under the same S3 layout, not a serving-layer change.
- **[v1.3 style]** Preserve the existing pattern of Dockerfile-based build-time asset generation with a matching local-dev script under `scripts/` for parity (see `download-firmware.sh`).

## Decisions

### 1. Vendor the `*.factory.bin` — write factory image at `0x00` (FLSH-08)

Switch both `Dockerfile.webapp` Stage 1 and `scripts/download-firmware.sh` from extracting `firmware-{target}-{version}.bin` (app-only) to extracting **`firmware-{target}-{version}.factory.bin`** (bootloader + partition table + app in one blob designed for `0x00`).

- The flash pipeline's `writeFlash({ address: 0x0 })` and `flashMd5sum(0x0, size)` in `apps/run.flash/webapp/src/hooks/use-flash.ts` (lines 98, 135) do not need to move — factory images are meant for offset `0x00`.
- Update `getFactoryFilename()` in `src/config/firmware.ts` to return `firmware-{platformioTarget}-{version}.factory.bin` (drop the misleading current `.bin`).
- **Verification (hard requirement before merge):** flash one ESP32-family device from the "Recommended" set end-to-end from the built image, confirm it boots and connects. STATE.md lists this as the highest open risk (FLSH-08) — do not rely on the version-resolution work until this is green.
- If Meshtastic's release zip layout ever changes (e.g., factory bin naming diverges), fail the build loudly, don't silently fall back to app-only.

**Why:** STATE.md flags FLSH-08 as an open risk: current app-only-at-`0x00` may not boot. Factory image is the flasher.meshtastic.org standard and the safest single-blob path.

### 2. Version resolution: mandatory API call at build with explicit build-arg override

Rewrite Stage 1 of `Dockerfile.webapp` so:

- Default path: `curl -fsSL https://api.meshtastic.org/github/firmware/list` → parse `releases.stable[0].id` (strip leading `v`) → this is `FIRMWARE_VERSION`.
- Override path: `--build-arg FIRMWARE_VERSION=x.y.z.hash` skips the API call. Used for rollback, hotfix pinning, and reproducible rebuilds.
- **No hardcoded fallback.** If the API is unreachable and no build-arg is given, **fail the build** — a silent stale version is worse than a broken build. CI will show the error immediately; a human picks a build-arg pin and reruns.
- Echo the resolved version to build logs on a dedicated line (`echo "Resolved Meshtastic stable: ${FIRMWARE_VERSION}"`), grep-able from CI output.

**Why:** Keeps `docker build` reproducible for rollbacks (build-arg pin) while making "clean build → current stable" the default (FLSH-06). Silent fallbacks would hide upstream API outages and defeat the "no hardcoded version anywhere" acceptance criterion.

### 3. Inject `FIRMWARE_VERSION` via `NEXT_PUBLIC_FIRMWARE_VERSION` env var (FLSH-07)

- Delete the hardcoded `export const FIRMWARE_VERSION = "..."` constant from `src/config/firmware.ts`. Replace with `export const FIRMWARE_VERSION = process.env.NEXT_PUBLIC_FIRMWARE_VERSION ?? ""`.
- `Dockerfile.webapp` builder stage: pass the resolved version as `ARG FIRMWARE_VERSION` and `ENV NEXT_PUBLIC_FIRMWARE_VERSION=$FIRMWARE_VERSION` before `npm run build`, mirroring the existing `NEXT_PUBLIC_ASSET_PREFIX` / `NEXT_PUBLIC_VERSION_APP` pattern (see lines 55–68 of the current Dockerfile).
- **Dev-time flow:** `scripts/download-firmware.sh` accepts a version arg (unchanged) and writes it to a local `.env.local` line (`NEXT_PUBLIC_FIRMWARE_VERSION=...`) so `next dev` picks it up without editing source. Document the one-command dev bootstrap in the script's usage banner.
- The build must fail if `NEXT_PUBLIC_FIRMWARE_VERSION` is empty when `next build` runs — enforce with a `next.config.ts` assertion or a pre-build check.
- UI surface: exact placement of the resolved-version chip in the flasher UI is deferred to Phase 19 (branding/UX). Phase 18 only guarantees the value is present in the compiled bundle and readable by any component.

**Why:** `NEXT_PUBLIC_` env is the standard Next.js pattern already used in this Dockerfile. Removes the TODO-placeholder anti-pattern in `firmware.ts`. Failing loudly on empty is critical — a silent empty string would produce broken firmware URLs at runtime.

### 4. Hardware list: dedicated Dockerfile stage + matching `scripts/generate-hardware-list.sh` (DEVC-06)

- Add a new Dockerfile stage (or extend Stage 1) that runs a Node script fetching `https://api.meshtastic.org/resource/deviceHardware`, filtering `architecture ∈ {esp32, esp32-s3, esp32-c3, esp32-c6}`, and writing to `public/data/hardware-list.json` — **overwriting** the tracked file.
- Add `scripts/generate-hardware-list.sh` for local dev parity. Same filter, same output path. Runnable independently.
- Keep `public/data/hardware-list.json` tracked in git as a snapshot for dev-without-network and PR-diff visibility of upstream changes. It is regenerated on every clean build regardless — the tracked file is a fallback, not the source of truth.
- **Recommended-set stays in `src/config/devices.ts`.** Do NOT bake `RECOMMENDED_SLUGS` into `hardware-list.json`. Keep the data-source separation: JSON = raw upstream truth, `devices.ts` = curated DCR34 opinion. The existing `isRecommended()` runtime lookup already handles sort-order.

**Why:** Mirrors the firmware-download pattern (Dockerfile stage + parallel dev script) — no new mental model. Overwriting the tracked JSON gives PR diffs when upstream Meshtastic adds/removes hardware. Keeping recommended in code preserves the current shape and avoids merge conflicts when Meshtastic revises the JSON.

### 5. Offline guarantee: build-time grep assertion + retain existing runtime posture (DPLY-06)

- After `next build` in the Dockerfile, add a build-step assertion: grep `.next/standalone` and `.next/static` output for `api.meshtastic.org` and `github.com/meshtastic`. **If found in client bundles, fail the build.** (Server-side / server-only code that runs never — like unused SSR paths — is out of scope; only the flasher runs in-browser.)
- No new runtime network test needed: the existing flasher already runs offline once firmware is vendored, and we're only *adding* build-time API calls. The runtime surface is unchanged.
- Document the offline-verification step in `apps/run.flash/README.md` as part of the build-verification checklist (release checklist, not a CI job).

**Why:** Cheapest possible enforcement of the "zero runtime network dependency" acceptance criterion. A grep of the built output catches accidental fetches introduced by a dependency upgrade in Phase 19. STATE.md's "offline-at-event" invariant demands defense-in-depth.

## Scope boundaries (do NOT do in this phase)

- **No branding changes.** "run.defcon.run firmware" naming, subtitle format, connect/error UX = **Phase 19**.
- **No dependency bumps.** `@meshtastic/core`, `@meshtastic/transport-web-serial`, `esptool-js` version changes = **Phase 19**.
- **No new device picker UI.** Sort/filter/badge behavior stays as-is; only the underlying `hardware-list.json` data source changes.
- **No S3 layout changes.** `build.sh` extraction to S3 and CloudFront asset-prefix serving are unchanged.
- **No version picker UI.** One auto-tracked stable build — v1.4 milestone decision, not up for re-litigation.
- **No CI workflow changes.** Existing `buildpub.yml` / GitHub Actions held-release pipeline is the delivery vehicle. If the workflow needs a build-arg to be plumbed through, do it minimally.

## Noted for later (out-of-phase ideas surfaced during analysis)

- **Cache-last-known-stable resilience:** If the meshtastic.org API becomes flaky at event time, a build-time cache of "last successful stable" could help. Out of scope for v1.4 — the build-arg override already covers rollback. Consider for a future v1.6+ hardening pass.
- **Automated post-build boot test:** A hardware-in-the-loop smoke test that flashes one device from CI and confirms it boots. Out of scope; manual verification per phase-3 checklist for now.
- **Two-track firmware channel (stable + beta):** Multiple channels would let event staff test upcoming releases. Explicitly rejected by v1.4 milestone ("no firmware version picker"). Do not add.

## Acceptance readiness

All five ROADMAP.md success criteria map to decisions above:

1. Factory image at `0x00`, boot-verified → **Decision 1**
2. Clean `docker build` on current stable, no hardcoded version → **Decisions 2 + 3**
3. `FIRMWARE_VERSION` build-injected, visible in flasher → **Decision 3** (UI placement to Phase 19)
4. ESP32-only hardware list regenerated at build, Recommended preserved → **Decision 4**
5. Zero runtime network calls → **Decision 5**

Ready for `/gsd:research-phase` or `/gsd:plan-phase`.
