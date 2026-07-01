---
phase: 18-build-time-firmware-device-list-refresh
verified: 2026-07-01T19:15:00Z
status: human_needed
score: 4/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "FLSH-08 — Recommended ESP32 device boot verification"
    expected: "One device from RECOMMENDED_SLUGS (HELTEC_V3, TBEAM, TLORA_V2_1_1P6, RAK4631, or STATION_G2), flashed end-to-end from a container built via `docker build -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/`, boots after unplug/replug (no bootloop) and connects to the Meshtastic Web/mobile UI."
    why_human: "Requires physical ESP32 hardware, a USB cable, and Chrome/Edge Web Serial. The switch from app-only `.bin` at 0x00 to `.factory.bin` at 0x00 is the whole reason this checkpoint exists — STATE.md flags it as the highest open v1.4 risk and it cannot be exercised in a headless sandbox."
  - test: "Clean `docker build` produces a container on the current Meshtastic stable"
    expected: "`docker build -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/` with no build-args (a) prints `Resolved Meshtastic stable: X.Y.Z.hash` in Stage 1, (b) prints `Extracted N firmware binaries` with N ≥ 1, (c) prints `Building with NEXT_PUBLIC_FIRMWARE_VERSION=X.Y.Z.hash` in Stage 2, and (d) reaches the runner stage with the offline grep gate silent."
    why_human: "Requires outbound network to api.meshtastic.org and github.com plus Docker daemon; sandbox verification is code-shape only. Also validates the DPLY-06 grep gate against a real `.next/standalone` — a synthetic check does not prove the gate is armed correctly."
  - test: "Runtime container makes zero calls to api.meshtastic.org or github.com/meshtastic (DPLY-06)"
    expected: "Running `docker run --rm -p 3000:3000 run-flash-p18` and exercising Pick Device → Connect → Flash → Configure → Done issues no requests to `api.meshtastic.org` or `github.com` (verify via container network capture or browser devtools Network tab)."
    why_human: "The Stage 2 grep gate is a static build-time check; runtime absence of network calls is a behavioral guarantee that only manual browser observation confirms."
---

# Phase 18: Build-Time Firmware & Device List Refresh — Verification Report

**Phase Goal:** A clean image build automatically vendors the correct, bootable latest-stable Meshtastic firmware and a refreshed ESP32-only device list, with zero external runtime dependency.

**Verified:** 2026-07-01T19:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Flashing an ESP32 device writes the vendored **factory** image at `0x00` (erase → write → MD5 verify) and produces a device that boots and connects | ? NEEDS HUMAN | Code path is in place: `firmware.ts:22` returns `firmware-{target}-{version}.factory.bin`; `use-flash.ts:98` writes `address: 0x0`; `use-flash.ts:135` calls `flashMd5sum(0x0, firmware.size)`. But "boots and connects" is the physical hardware assertion and requires the FLSH-08 checkpoint (see plan 18-03 Task 3, `checkpoint:human-verify`, blocking). |
| 2 | Clean `docker build` (no code edits, no build-args) produces a flasher on the **current** Meshtastic stable, resolved from `api.meshtastic.org/github/firmware/list` (`releases.stable[0]`); no hardcoded version remains | ✓ VERIFIED | `Dockerfile.webapp:11-19` resolves via `curl -fsSL … | jq -r '.releases.stable[0].id' | sed 's/^v//'` and hard-fails with a named error when the API is unreachable and no build-arg is provided. Grep confirms no `FW_VER=<digit>` hardcoded fallback and no `COPY src/config/firmware.ts` (that constant was removed in 18-01). Repo-wide grep for `2.6.11.60ec05e` and `FIRMWARE_VERSION\s*=\s*"[0-9]` returns nothing under `apps/run.flash/webapp/src/`. |
| 3 | `FIRMWARE_VERSION` is build-injected as the single source of truth (no manual placeholder in `src/config/firmware.ts`) and the resolved version is visible in the flasher | ✓ VERIFIED | `firmware.ts:4` → `process.env.NEXT_PUBLIC_FIRMWARE_VERSION ?? ""`; `next.config.ts:6-11` throws in production when empty; `next.config.ts:43` exposes the value in `env:` so it is baked into the client bundle; `flash-step.tsx:129` renders `{FIRMWARE_VERSION}` in the UI. |
| 4 | Device picker shows an ESP32-only hardware list regenerated at build from `api.meshtastic.org/resource/deviceHardware` (esp32/esp32-s3/esp32-c3/esp32-c6), with the DCR34 Recommended set preserved and sorted first | ✓ VERIFIED (with WARNING on tracked snapshot) | Dockerfile Stage 1 (`Dockerfile.webapp:36-40`) fetches the endpoint and jq-filters to the exact four ESP32 architectures; Stage 2 (`Dockerfile.webapp:68`) overwrites `./public/data/hardware-list.json` inside the image before `npm run build` reads it. Recommended-set preservation is code-side and orthogonal to the JSON snapshot: `devices.ts:23` defines `RECOMMENDED_SLUGS`, `devices.ts:61-64` sorts recommended devices first. **Warning:** the *tracked* `public/data/hardware-list.json` on the branch still contains 88 entries including `nrf52840`, `rp2040`, and un-dashed `esp32s3`. This is stale versus the Dockerfile filter set. It does not affect the shipped image (Dockerfile overwrites it) but does mean `next dev` without running `scripts/generate-hardware-list.sh` shows the pre-filter list. See Warnings below. |
| 5 | Running container makes no network calls to GitHub or `api.meshtastic.org` (offline-at-event guarantee) | ✓ VERIFIED (mechanism) / ? NEEDS HUMAN (runtime observation) | `Dockerfile.webapp:95-97` — post-build grep gate: `grep -rE 'api\.meshtastic\.org|github\.com/meshtastic' .next/standalone .next/static` fails the build if any hit is found, naming DPLY-06 in the error. Runtime absence of network calls under a real Pick → Connect → Flash → Done flow is a behavioral guarantee that only manual verification can confirm (see human verification item 3). |

**Score:** 4 / 5 truths programmatically verified; 1 requires the FLSH-08 hardware boot test.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/run.flash/webapp/src/config/firmware.ts` | Env-injected `FIRMWARE_VERSION` + `.factory.bin` filename generator | ✓ VERIFIED | Line 4 reads from `process.env.NEXT_PUBLIC_FIRMWARE_VERSION ?? ""`; line 22 returns `firmware-{platformioTarget}-{version}.factory.bin`. Imported by `flash-step.tsx:16` and `use-flash.ts:6` (WIRED). TypeScript typecheck passes clean. |
| `apps/run.flash/webapp/next.config.ts` | Production assertion + client-bundle env plumbing | ✓ VERIFIED | Lines 6-11 throw with a named error message referencing the Dockerfile builder ARG and `scripts/download-firmware.sh` when `NODE_ENV=production` and the env var is empty; line 43 exposes it via `env:`. |
| `apps/run.flash/README.md` | Release checklist covering offline verify + FLSH-08 hardware boot test | ✓ VERIFIED | Contains `## Release verification checklist`, `### Offline guarantee (DPLY-06)` with the `grep -rE 'api\.meshtastic\.org|github\.com/meshtastic' .next/standalone .next/static` command, and `### Hardware boot test (FLSH-08)` referencing `RECOMMENDED_SLUGS`. |
| `apps/run.flash/webapp/scripts/download-firmware.sh` | Dev-parity factory-image downloader + `.env.local` writer | ✓ VERIFIED | `bash -n` passes; executable; calls the firmware-list API (line 31), extracts `.factory.bin` (line 68), idempotently writes `NEXT_PUBLIC_FIRMWARE_VERSION` to `.env.local` (lines 92-95). No longer greps `src/config/firmware.ts`. |
| `apps/run.flash/webapp/scripts/generate-hardware-list.sh` | ESP32-only hardware list regenerator | ✓ VERIFIED | `bash -n` passes; executable; fetches `api.meshtastic.org/resource/deviceHardware` (line 30), jq-filters to the exact four ESP32 architectures (line 31), validates non-empty (line 34), atomically writes to `public/data/hardware-list.json`. |
| `apps/run.flash/webapp/Dockerfile.webapp` | Build-time version resolve + factory vendoring + hardware-list regen + env plumbing + offline grep gate | ✓ VERIFIED | Stage 1 (lines 1-40) installs `jq`, resolves via API (lines 11-19), extracts `.factory.bin` (line 27), persists version to `VERSION.txt` (line 32), regenerates hardware-list (lines 36-40). Stage 2 (lines 42-97) copies VERSION.txt + hardware-list into the app tree, exports `NEXT_PUBLIC_FIRMWARE_VERSION` for `npm run build` (lines 87-91), and runs the DPLY-06 grep gate (lines 95-97). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `firmware.ts` | `process.env.NEXT_PUBLIC_FIRMWARE_VERSION` | module-scope constant | ✓ WIRED | `firmware.ts:4` reads env at module load; consumers use the imported constant (`flash-step.tsx:16, 129`). |
| `firmware.ts` | `*.factory.bin` | `getFactoryFilename` return | ✓ WIRED | `firmware.ts:22` returns the `.factory.bin` template; consumed by `use-flash.ts` via `loadFirmware(device)` at line 65. |
| `next.config.ts` | production throw on empty `NEXT_PUBLIC_FIRMWARE_VERSION` | production-only assertion | ✓ WIRED | Lines 6-11; gated by `isDev` (line 4). |
| `download-firmware.sh` | `api.meshtastic.org/github/firmware/list` | `curl -fsSL` default | ✓ WIRED | Line 26 defines the URL, line 31 invokes it. |
| `download-firmware.sh` | `.env.local` `NEXT_PUBLIC_FIRMWARE_VERSION=` | grep -v + append (idempotent) | ✓ WIRED | Lines 92-95 preserve other lines, drop any existing `NEXT_PUBLIC_FIRMWARE_VERSION=`, append the new value, atomic `mv`. |
| `generate-hardware-list.sh` | `public/data/hardware-list.json` | jq filter + atomic write | ✓ WIRED | Lines 30-40. |
| `Dockerfile.webapp` Stage 1 | `api.meshtastic.org/github/firmware/list` | `curl -fsSL` default | ✓ WIRED | Line 13. |
| `Dockerfile.webapp` Stage 1 | `api.meshtastic.org/resource/deviceHardware` | `curl -fsSL` + `jq` | ✓ WIRED | Line 37. |
| `Dockerfile.webapp` builder | `NEXT_PUBLIC_FIRMWARE_VERSION` env for `next build` | export + build in same RUN | ✓ WIRED | Lines 87-91. |
| `Dockerfile.webapp` builder (post-build) | `.next/standalone` + `.next/static` grep gate | `grep -rE … && exit 1` | ✓ WIRED | Lines 95-97; error message references DPLY-06 for triage. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `firmware.ts::FIRMWARE_VERSION` | `process.env.NEXT_PUBLIC_FIRMWARE_VERSION` | Dockerfile builder ARG (prod) or `.env.local` from `download-firmware.sh` (dev) | Yes (build-time injected string); grep-verified rendered in `flash-step.tsx:129` | ✓ FLOWING |
| `firmware.ts::getFactoryFilename` | `device.platformioTarget` + `FIRMWARE_VERSION` | `DeviceHardware` records from `public/data/hardware-list.json`, consumed by `use-flash.ts:65` | Yes — `use-flash.ts:97-98` writes `firmware.data` at `address: 0x0` | ✓ FLOWING (bootability itself is the FLSH-08 human check) |
| `public/data/hardware-list.json` | JSON array of ESP32-family devices | Overwritten in Dockerfile Stage 2 from Stage-1 regenerated list | Yes at build; tracked snapshot is stale (see Warnings) | ✓ FLOWING (build); ⚠️ STALE (tracked) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript typechecks the webapp with the new firmware.ts contract | `cd apps/run.flash/webapp && npx tsc --noEmit -p tsconfig.json` | exit 0, no output | ✓ PASS |
| `download-firmware.sh` parses under bash | `bash -n apps/run.flash/webapp/scripts/download-firmware.sh` | exit 0 | ✓ PASS |
| `generate-hardware-list.sh` parses under bash | `bash -n apps/run.flash/webapp/scripts/generate-hardware-list.sh` | exit 0 | ✓ PASS |
| No hardcoded firmware version literal remains under `src/` | `grep -RnE '2\.6\.11\.60ec05e|FIRMWARE_VERSION\s*=\s*"[0-9]' apps/run.flash/webapp/src` | no matches | ✓ PASS |
| Docker build resolves and vendors + grep gate is armed | `docker build -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/` | not executed | ? SKIP (needs Docker + outbound network; routed to human verification) |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| n/a | — | Phase does not declare probes; project does not use `scripts/*/tests/probe-*.sh` convention. | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FLSH-06 | 18-02, 18-03 | Docker build resolves latest stable from firmware-list API; no hardcoded version | ✓ SATISFIED | Truth 2 evidence; `Dockerfile.webapp:11-19`. |
| FLSH-07 | 18-01, 18-02, 18-03 | `FIRMWARE_VERSION` build-injected single source of truth, surfaced in UI | ✓ SATISFIED | Truth 3 evidence; `firmware.ts:4`, `next.config.ts:43`, `flash-step.tsx:129`. |
| FLSH-08 | 18-01, 18-02, 18-03 | Factory image at 0x00 flashes a bootable device | ? NEEDS HUMAN | Code path in place (`.factory.bin` + `writeFlash(0x0)` + `flashMd5sum(0x0, size)`); boot behavior requires physical hardware — routed to human verification item 1. |
| DEVC-06 | 18-02, 18-03 | `hardware-list.json` regenerated at build from deviceHardware API, ESP32-only, Recommended preserved | ✓ SATISFIED (with tracked-snapshot Warning) | Truth 4 evidence; `Dockerfile.webapp:36-40, 68`; `devices.ts:23, 61-64`. |
| DPLY-06 | 18-01, 18-03 | Resolution build-time only, no runtime dependency on GitHub / api.meshtastic.org | ✓ SATISFIED (mechanism) / ? NEEDS HUMAN (runtime observation) | Truth 5 evidence; `Dockerfile.webapp:95-97`; README release checklist. Runtime observation routed to human verification item 3. |

**Orphan check:** No requirement IDs mapped to Phase 18 in REQUIREMENTS.md are absent from PLAN frontmatter. All five phase requirements appear in at least one plan's `requirements:` field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`, `FIXME`, `XXX` in phase-modified files | — | none |
| — | — | No `TODO`, `HACK`, `placeholder`, "coming soon" markers | — | none |

Scan covered `apps/run.flash/webapp/src/config/firmware.ts`, `apps/run.flash/webapp/next.config.ts`, `apps/run.flash/README.md`, `apps/run.flash/webapp/scripts/download-firmware.sh`, `apps/run.flash/webapp/scripts/generate-hardware-list.sh`, `apps/run.flash/webapp/Dockerfile.webapp`. Clean.

### Warnings (non-blocking)

- **Tracked `public/data/hardware-list.json` is stale versus the new filter.** The tracked snapshot on this branch contains 88 entries spanning architectures `esp32`, `esp32-c3`, `esp32-c6`, `esp32-s3`, `esp32s3` (un-dashed), `nrf52840`, and `rp2040`. The Dockerfile Stage 1 regeneration overwrites this file inside the image, so the *shipped* image is ESP32-only. However:
  - `next dev` locally will render the pre-filter list until `scripts/generate-hardware-list.sh` is run.
  - The tracked snapshot no longer matches the intended runtime shape, which will cause noisy diffs the next time a maintainer or CI regenerates it.
  - Suggested (not required for phase closure): run `apps/run.flash/webapp/scripts/generate-hardware-list.sh` and commit the refreshed snapshot as a follow-up, or add a CI check that regenerates and diffs against the tracked file.

### Human Verification Required

The three items below block phase closure because none can be exercised in this sandbox. All three appear in the frontmatter `human_verification:` block for downstream tooling.

#### 1. FLSH-08 — Recommended ESP32 device boot verification

**Test:**
1. Build the image: `docker build -t run-flash-p18 -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/`
2. Run: `docker run --rm -p 3000:3000 run-flash-p18`
3. Open http://localhost:3000/ in Chrome or Edge (Web Serial required).
4. Plug in ONE device from the Recommended set — pick any of: `HELTEC_V3`, `TBEAM`, `TLORA_V2_1_1P6`, `RAK4631`, `STATION_G2`.
5. Walk Pick Device → Connect → Flash → Configure → Done.
6. Unplug and replug the device.

**Expected:** Device shows the Meshtastic boot sequence (LED/display), does not bootloop, and connects (Meshtastic Web/mobile UI sees the node, or the flasher's post-flash configure step succeeds). Record the tested device slug and the resolved firmware version from the build log in `18-03-SUMMARY.md`.

**Why human:** Requires physical ESP32 hardware, a USB cable, and Chrome/Edge Web Serial. The switch from app-only `.bin` at `0x00` to `.factory.bin` at `0x00` is the whole reason this checkpoint exists — STATE.md flags it as the highest open v1.4 risk (FLSH-08). It cannot be exercised in a headless sandbox.

#### 2. Clean `docker build` produces a container on the current Meshtastic stable

**Test:** Run `docker build -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/` with no `--build-arg` and outbound network to api.meshtastic.org and github.com.

**Expected:** Build log includes:
- `Resolved Meshtastic stable: X.Y.Z.hash` in Stage 1
- `Extracted N firmware binaries` with N ≥ 1
- `Building with NEXT_PUBLIC_FIRMWARE_VERSION=X.Y.Z.hash` in Stage 2
- No output from the DPLY-06 grep gate (grep silent = pass) and the build reaches the `runner` stage

**Why human:** Sandbox has no Docker daemon and no outbound network to those hosts, so verification is code-shape only in this pass. Also confirms the grep gate is armed against a real `.next/standalone` — a synthetic check does not prove correctness at scale.

#### 3. Runtime container makes zero calls to api.meshtastic.org or github.com/meshtastic (DPLY-06)

**Test:** With the container from step 2 running (`docker run --rm -p 3000:3000 run-flash-p18`), exercise Pick Device → Connect → Flash → Configure → Done in the browser while watching the container's outbound network (e.g., `docker exec … tcpdump` or Chrome/Edge DevTools Network tab filtered to `meshtastic.org` and `github.com/meshtastic`).

**Expected:** Zero requests to `api.meshtastic.org` or `github.com/meshtastic` during the full flash flow.

**Why human:** The Stage 2 grep gate is a static build-time guarantee; behavioral absence of network calls at runtime requires manual browser or packet observation.

### Gaps Summary

No structural gaps. All code, scripts, and Dockerfile changes match the plan contracts and downstream imports typecheck clean. The remaining work is entirely human-verified: (a) the FLSH-08 hardware boot test that plan 18-03 explicitly encodes as a blocking `checkpoint:human-verify` gate, (b) a full `docker build` execution that requires outbound network and a Docker daemon, and (c) runtime network observation confirming no calls to the upstream hosts. Warning: the tracked `public/data/hardware-list.json` snapshot is stale versus the new ESP32-only filter — non-blocking for phase closure because the Dockerfile regenerates it into the shipped image.

---

_Verified: 2026-07-01T19:15:00Z_
_Verifier: Claude (gsd-verifier)_
