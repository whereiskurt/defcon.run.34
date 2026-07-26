# run.flash "Download config" — Design

**Date:** 2026-07-26
**Status:** Approved (Kurt, 2026-07-26 — ship live authorized)
**Scope:** Let a signed-in user download the exact device configuration run.flash
would push — BEFORE (or without ever) flashing — so they can manually configure
a radio by cut&paste.

## Problem

run.flash pushes a per-user config (MQTT creds, channel PSKs, identity, LoRa
settings, ringtone, position/map settings) over WebSerial. People who can't or
won't use the web flasher (iPhone/no-WebSerial browsers, pre-configured radios,
CLI users) have no way to get those values for a manual setup.

## Decisions (ratified)

| Question | Decision |
|----------|----------|
| Formats | **All three**: readable `.txt` (app-screen-grouped), raw `.json` payload, `meshtastic` CLI `.sh` script |
| Placement | **Configure step + landing page** — download menu on the Configure step before the push, plus a standalone "Manual setup" card on the signed-in landing (device-independent) |
| Delivery | Ship live (use1) in the same pass |

## Architecture

**No new API.** The auth-gated `/api/config` (`DeviceConfigPayload`) already
contains everything. The feature is client-side serialization of that payload.

### New module: `apps/run.flash/webapp/src/lib/config-export.ts`

Three pure functions `(payload: DeviceConfigPayload) => string`:

- `toReadableText` → `dcrun-radio-config.txt` — sections grouped by Meshtastic
  phone-app screens (MQTT server/port/TLS/username/password/root topic;
  Channels name/PSK/role/position precision; LoRa region/preset/hop limit;
  User long/short name; Ringtone RTTTL; Position & Map-report values), each
  with a one-line "where this goes" hint. Header line: keep this file private.
- `toJson` → `dcrun-radio-config.json` — pretty-printed payload verbatim.
- `toCliScript` → `dcrun-radio-config.sh` — commented `meshtastic --set …` /
  `--ch-set psk base64:… --ch-index N` sequence mirroring exactly what the
  flasher pushes. Header comment: keep private; requires the Python CLI.

Plus `downloadConfig(payload, format)` — Blob + anchor download helper.

Pure functions covered by vitest with a fixture payload (base64 PSK handling,
RTTTL quoting, TLS/port mapping).

### UI

- **Configure step** (`components/configure/configure-step.tsx`): secondary
  "Download config" dropdown (txt / json / sh) visible before the push starts;
  payload is already fetched there.
- **Landing** (signed-in): "Manual setup" card — on click fetches
  `/api/config`, then offers the same three downloads. A 404 (user not
  MQTT-provisioned) shows the existing provisioning hint, not a broken
  download.

## Security

Files contain the user's own MQTT password and channel PSKs — the same secrets
the authed flasher already fetches and pushes; no new exposure surface. txt/sh
carry a "keep this private" header. No server changes, no logging of payloads.

## Out of scope

- No change to the flash/serial pipeline or `/api/config`.
- No QR / channel-URL encoding (possible follow-up).
- No CMS copy-catalog additions beyond button/card labels following the
  existing flash copy pattern.

## Testing

- vitest: three serializers against a fixture payload; filename/MIME mapping.
- Build + existing flash test suite green.
- Live UAT: signed-in user downloads all three formats from both placements;
  values match `/api/config`.
