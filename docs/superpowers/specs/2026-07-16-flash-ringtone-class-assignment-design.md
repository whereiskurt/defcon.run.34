# Class-Based Ringtone Assignment for run.flash

**Date:** 2026-07-16
**Status:** Design approved — ready for implementation plan
**Apps touched:** `run.human` (data model + admin setter + internal API), `run.flash` (gate + device push)

## Problem

When a runner flashes their Meshtastic radio at `flash.defcon.run`, every device
receives the same firmware config. We want the ringtone (the RTTTL tune the
device's buzzer plays) to vary by *who the runner is*:

- **Rabbits** (default runners) get the default tune.
- **Hares** (`wildhare`) and **OGs** (`og`) get their own distinct tunes.
- **Admins** get an admin tune.
- **Specific individuals** (e.g. Kurt, Jesse) can be given a personal tune that
  overrides the class default.

This is the first concrete instance of a broader idea — assigning device config
by runner profile — but this slice is **ringtone only**.

## Key existing primitives (already in the codebase)

- **The gate point exists.** `run.flash`'s `GET /api/config`
  (`apps/run.flash/webapp/src/app/api/config/route.ts`) fetches the runner's
  profile from run.human's internal API and assembles the `DeviceConfigPayload`
  that `pushDeviceConfig()` writes to the radio. This is the one place to branch.
- **The runner-class primitive exists.** `RunUser.mqttUsertype` is an enum:
  `rabbit | wildhare | admin | og` — literally last year's rabbit / hare
  (`wildhare` renders as "hare") / OG concept. It is **already returned** by the
  internal user API to run.flash.
- **The device-write path is proven.** Meshtastic stores the ringtone as an
  `RTTTLConfig.ringtone` string set via `AdminMessage.set_ringtone_message`.
  `@meshtastic/core` has no `setRingtone()` helper, but the same lib already
  ships a working template: `setCannedMessages` builds an `AdminMessage` and
  sends it to the `ADMIN_APP` port via `sendPacket`. We mirror that exactly.

## Design

**One precedence chain, applied everywhere:**

```
per-user RunUser.ringtone field  →  class default (ringtoneForClass(mqttUsertype))  →  rabbit default (ultimate fallback)
```

The result is never empty.

### 1. Data model — `run.human` (additive, no migration)

Add an optional `ringtone` attribute (RTTTL string) to the `RunUser` ElectroDB
entity (`apps/run.human/webapp/src/entities/run-user.ts`), placed beside the
`mqtt*` provisioning fields.

- Additive ElectroDB attribute → **no migration**; null for all existing users.
- Named plain `ringtone` (not `mqttRingtone`) — it is a Meshtastic device
  setting, not an MQTT credential — but lives in the provisioning cluster.
- Add `ringtone` to the `RunUserItem` TypeScript type / update-profile shape.

### 2. Setter — `run.human` admin UI

The per-user `ringtone` field is set by an admin from the existing admin console
(`run.defcon.run/admin`). No public upload UI in this slice.

- **`PATCH /api/admin/users/[userId]`** — new handler added to the existing route
  file (`apps/run.human/webapp/src/app/api/admin/users/[userId]/route.ts`),
  reusing that file's exact gate contract: `requireAdmin(session)` +
  `revalidateAdmin(authUserId)`, and **every denial returns a bare 404** (no
  403/body), matching the existing GET handler.
  - Body: `{ ringtone: string | null }`.
  - Validate the string is a legal RTTTL (see Validation below) and within the
    Meshtastic length cap. `null` / empty clears the field (reverts that runner
    to their class default).
  - Persist via `updateRunUserProfile(userId, { ringtone })`
    (the helper already used by the internal PATCH route).
  - `revalidateAdmin` / cache invalidation consistent with sibling admin routes.
- **Drawer editor** — a small "Ringtone" row in the existing per-user drawer in
  `AdminConsole.tsx`: shows the current tune (or "— (class default)"), a text
  input for the RTTTL, and **Save** / **Clear** actions. Client-side RTTTL
  validation mirrors the server validator. The GET drawer endpoint
  (`GET /api/admin/users/[userId]`) is extended to return the current `ringtone`
  so the editor can pre-fill.
- **Internal API** — `GET /api/internal/user/[oidcSub]` returns `ringtone`
  (one added field on the existing safe-subset response) so run.flash can read
  it. It is non-secret device-config content, safe to expose over the existing
  internal-secret channel alongside `mqttUsertype`.

### 3. Gate + push — `run.flash`

- **`ringtoneForClass(mqttUsertype)`** — a frozen map in
  `apps/run.flash/webapp/src/config/meshtastic.ts` (alongside the existing PSK /
  region defaults), returning the class default RTTTL:
  `rabbit → default`, `wildhare → hare tune`, `og → og tune`,
  `admin → admin tune`, unknown/undefined → rabbit default. **Placeholder RTTTL
  tunes**, swappable in one PR.
- **`/api/config`** — compute
  `const ringtone = user?.ringtone?.trim() || ringtoneForClass(user?.mqttUsertype)`,
  clamp/validate to the Meshtastic RTTTL length cap (defense in depth), and add
  `ringtone` to the returned `DeviceConfigPayload`. Update the
  `DeviceConfigPayload` type (`apps/run.flash/webapp/src/types/config.ts`).
- **`pushDeviceConfig`** — add a new **"ringtone" stage** in
  `apps/run.flash/webapp/src/lib/meshtastic.ts`, placed **after identity, before
  commit**. Build an `AdminMessage` with the `setRingtoneMessage` payload variant
  and send it via `device.sendPacket(toBinary(AdminMessageSchema, msg),
  PortNum.ADMIN_APP, "self")`, mirroring the existing `setCannedMessages`
  pattern. (Requires importing `toBinary` from `@bufbuild/protobuf` and using
  `Protobuf.Admin.AdminMessageSchema` + `Types.PortNum.ADMIN_APP` — the latter
  already imported.)
- Add `"ringtone"` to the `ConfigStage` union and to the wizard's stage checklist
  UI so the push shows a progress row.

### Validation (RTTTL)

A shared, minimal RTTTL sanity check (used client-side in the admin editor,
server-side in the admin PATCH, and defensively in run.flash `/api/config`):

- Non-empty after trim.
- Within Meshtastic's ringtone length cap (~230 chars — confirm exact cap at
  plan time from the firmware constant; clamp/reject beyond it).
- Loose structural check for RTTTL shape (`name:defaults:notes`) — reject
  obviously non-RTTTL input, but keep it permissive (do not reimplement a full
  RTTTL parser).

## Explicitly out of scope (this slice)

- **Buzzer enablement.** MVP writes the *tune* to the device (the assignment).
  It does **not** push an External Notification module config, so bare boards
  (e.g. Heltec V3 without a buzzer) store the tune but stay silent. Enabling the
  External Notification module / buzzer output is a **separate follow-up phase**.
- **Public "upload your own ringtone" UI.** The `ringtone` field is designed to
  be the write target for a future self-serve upload, but only the admin setter
  ships now.
- **Generalized config-by-profile** (channels / region / etc. overrides by
  class). Ringtone is the first field; the broader layer is a later idea.

## Testing

- **run.human**
  - PATCH `/api/admin/users/[userId]`: gate denial paths all → 404; happy path
    calls `updateRunUserProfile` with the validated ringtone; `null` clears.
  - RTTTL validator unit tests (valid, too-long, empty, junk).
  - Internal user API returns `ringtone`.
- **run.flash**
  - `ringtoneForClass` map returns the right tune per class + fallback for
    unknown/undefined.
  - `/api/config` precedence: per-user field set (wins), unset (class default),
    unknown class (rabbit default); length clamp applied.
  - `pushDeviceConfig` ringtone stage: asserts `sendPacket` is called with an
    `AdminMessage` carrying the expected RTTTL on the `ADMIN_APP` port, in the
    correct order (after identity, before commit).
  - Offline-invariant grep (README DPLY-06) unaffected — no new runtime hosts.

## Risks

- **Device-write path** — low risk; proven by the in-repo `setCannedMessages`
  template. Confirm `setRingtoneMessage` payload-variant name and `ADMIN_APP`
  routing against the pinned `@meshtastic/core` version during execution.
- **RTTTL length cap** — confirm the exact firmware cap at plan time; clamp
  server-side so an over-long tune can never desync the config push.
- **Field exposure** — `ringtone` crosses the internal-secret channel; it is
  non-secret device content (like `mqttUsertype`), not a credential. No new
  secret surface.
