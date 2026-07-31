---
created: 2026-07-31T04:30:00Z
title: "run.flash Docker build silently ships an incomplete firmware payload (warn-only nightly fetch)"
area: run.flash
priority: high
---

Caught live during the v0.0.56 release (2026-07-31). The build went **green** while
dropping 8 firmware binaries. Nothing failed, nothing warned loudly, and the image
shipped to ECR. Discarded v0.0.56 and rebuilt as v0.0.57, which came out clean — but
the gap that allowed it is still open and will recur.

## What happened

`Dockerfile.webapp` Stage 1 (`firmware 6/7`) fetches each target one-by-one from
`raw.githubusercontent.com/meshtastic/meshtastic.github.io/<REF>/firmware-nightly`.
Roughly 200 sequential `curl` calls per build, each with only `--retry 2`. A handful
of transient failures got counted as "missing" and the build carried on.

| Build | stable `b4ff1df` | previous `dafa583` | baked | app image |
|-------|------------------|--------------------|-------|-----------|
| v0.0.55 (07-30) | 86 / 13 miss | 86 / 13 miss | 172 | 321,891,114 B |
| **v0.0.56 (07-31)** | **84 / 15 miss** | **80 / 19 miss** | **164** | 314,296,748 B |
| v0.0.57 (rebuild) | 86 / 13 miss | 86 / 13 miss | 172 | 322,337,350 B |

Ground truth measured directly against the pinned ref `a5f4b0df` with `--retry 3`:
**51 esp32 `.factory.bin` + 35 `.uf2` = 86 available.** The 13 "missing" are genuinely
absent upstream (retired boards: `heltec-v1`, `heltec-v2_0`, `heltec-v2_1`,
`heltec-wireless-paper-v1_0`, `heltec-wireless-tracker-V1-0`, `meshtastic-dr-dev`,
`t5-epaper-s3`, `tbeam0_7`, `tlora-v1`, `tlora-v1_3`, `tlora-v2`, `tlora-v2-1-1_8`).
So 86 is the correct number and v0.0.56 was 8 short — 2 of them on the **default** slot.

Both builds saw the same 99-target universe and pull from **immutable pinned commit
refs**, so this is not upstream drift and not a hardware-list change. It is fetch
flakiness, full stop.

## Why it slipped through

The nightly path only hard-fails at *zero* targets:

```sh
echo "Nightly $FW_VER: $GOT targets fetched, $MISS missing (warn-only)";
[ "$GOT" -gt 0 ] || { echo "ERROR: nightly fetched zero targets"; exit 1; };
```

`$GOT > 0` is satisfied by a single file. There is no floor and no comparison against
the previous release. The pinned-release path directly below it is stricter (it
requires ≥1 `.factory.bin`), but the nightly path — the one both live slots use — is
the loose one.

## Impact

A runner at con selects an affected board, hits Flash, and gets
`Firmware not found for <device>. Expected file: firmware-<target>-<ver>.factory.bin
(HTTP 404)` from `loadFirmware` (`src/config/firmware.ts`). Silent until someone with
that exact board tries to flash.

## Fix options (not yet implemented)

1. **Floor check** — record the expected count per slot and fail when `$GOT` drops
   below it. Strongest signal; needs the expected number kept somewhere (a field in
   `firmware-versions.json` alongside `pin`/`ref` would fit).
2. **Harden the fetch** — raise per-target retries to `--retry 5 --retry-all-errors`,
   matching what the `index.json` fetch in the same block already uses. Cheapest
   change, reduces recurrence but does not detect it.
3. **Both** — retry hardening plus a floor, so a bad build is loud rather than quiet.

Worth doing (2) at minimum before the next flash release, since it is a one-line edit
to `Dockerfile.webapp` and `scripts/download-firmware.sh` must stay in parity.

## Verification recipe

```bash
gh run view <run-id> --log | grep -oE "Nightly [0-9.a-f]+: [0-9]+ targets fetched, [0-9]+ missing"
# expect 86 fetched / 13 missing per slot for the current pins

AWS_PROFILE=dc34-application aws s3 ls \
  s3://cf-assets-flash-use1-dc34-.../use1/assets/public/firmware/ | grep -c <fw-version>
# expect 86 per firmware version
```

⚠️ The S3 asset bucket returns **403, not 404**, for nonexistent keys — a 403 when
probing a firmware URL is not proof the file is missing. Correct live path is
`/use1/assets/public/firmware/`, not `/use1/assets/firmware/`.

Related: [[project_flash_multi_firmware_app_downloads]]
