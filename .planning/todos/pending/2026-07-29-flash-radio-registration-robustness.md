---
created: 2026-07-29T21:35:00Z
title: "flash.defcon.run — radio registration is fire-and-forget with no reconciliation"
area: run.flash
priority: high
---

Kurt 2026-07-29: configured a radio via flash.defcon.run and it **never registered** — the
radio works on the mesh but has no MeshRadio row. Asked to make it more robust. Sequenced
**after** the meshtk shared-chain blockers (see
`2026-07-29-meshtk-proxy-shared-chain-blockers.md`).

## How it works today
After the config push + commit + read-back verify succeeds, the wizard POSTs
`{nodeId, privateKey, publicKey}` to `/api/register-radio`
(`apps/run.flash/webapp/src/hooks/use-configure.ts:202`). That proxy route
(`apps/run.flash/webapp/src/app/api/register-radio/route.ts:16`) checks the NextAuth session,
`assertNotLockedLive`, then forwards with `x-internal-secret` to run.human's internal route
(`apps/run.human/webapp/src/app/api/internal/meshtastic-radios/route.ts:32`), which resolves
oidcSub → adapter userId, canonicalizes nodeId, converts the base64 pubkey to `0x` hex, and
either `patchMeshRadio` (`:144`) or quota-consume + `upsertMeshRadio` (`:172`,
`verified:true, source:"flash", impersonate:true`). Welcome DM is enqueued best-effort (`:124-136`).

Note: MeshRadio holds no MQTT username — creds live on RunUser and flash only *reads* them
to build the device config (`apps/run.flash/webapp/src/app/api/config/route.ts:68-91`).
Row key is `pk = "$run#nodeid_!xxxxxxxx"`, `sk = "$meshradio_1"`.

## ⚠️ CONFIRMED IN PROD 2026-07-29 21:32Z — cross-user key overwrite (hole 0)

Kurt flashed two radios; one registered, one "didn't register but didn't fail". Live DDB
evidence from `run-human-electro` (scan of `$run#nodeid_*`, 23 rows):

| nodeId | createdAt | touched | owner |
|---|---|---|---|
| `!174e59c8` | 2026-07-29T21:27:09Z | 21:27:09Z (new row) | `041287e3-…` (Kurt) |
| `!4359d0cc` | **2026-07-21**T04:35:54Z | **2026-07-29T21:32:55Z** ← patched | `473d02cd-…` (**different user**) |

Radio B is `!4359d0cc`. Its node num is MAC-derived, so re-flashing did **not** change it —
and it was already registered on 07-21 by **another account** (a reused/loaner radio). The
internal route found the existing row, took the `existing` branch
(`api/internal/meshtastic-radios/route.ts:139`) and called
`patchMeshRadio(canonicalNodeId, { publicKey, privateKey, verified: true })` — which
**never checks `existing.userId === adapterUserId` and never sets `userId`**. Result:

- HTTP **200 `{updated:true}`** → the wizard renders the teal "registered (updated)" line
  (`components/done/done-step.tsx:202-212`), visually a success. Nothing fails. ✅ explains
  "won't register and doesn't seem to fail".
- No row is ever created for Kurt — the radio stays owned by the 07-21 account.
- **Kurt's device keys were written onto another user's row and marked `verified: true`.**
  Since phase 66 made MeshRadio the authoritative decrypt source
  (`keycache/store.go:82`), that radio's traffic now decrypts and attributes to the other
  account, not to Kurt.
- The mismatch propagated to a **second table**: the queued welcome DM for `!4359d0cc`
  (`$meshwelcomepending`, created 21:32:55Z) carries `userId=041287e3` (Kurt) and reads
  "Welcome to defcon.run, KPH!" — addressed to a node the authoritative row says is not his.
  It has **not fired yet** (liveness gate holds it in the waiting pool).

Row state after the patch (no key material read): `userId=473d02cd`, `source=flash`,
`verified=true`, `verifiedAt=2026-07-21` (stale — patch sets `verified` but not `verifiedAt`),
`impersonate=true`, `showOnMap=false`, `updatedAt=2026-07-29T21:32:55Z`.

Two earlier inferences CORRECTED after checking:
- `impersonate: true` is **not** rabbit-specific — it is the flash create-path default
  (`route.ts` upsert sets `impersonate: true`), so it says nothing about the victim row's kind.
- `!4359d0cc` is **not** in the ghost/rabbit fleet config (the only repo hit is a doc-comment
  example at `apps/run.gpx/webapp/src/lib/mesh-nodes.ts:83`), so **no live ghost was re-keyed** —
  the `NEVER re-key ghosts without rotating node IDs` landmine was not tripped.

The other account's displayName is `rabbit_473d` — an auto-generated
`rabbit_<first4-of-userId>` pattern, and the row's `source=flash` means someone ran the
wizard under that account on 07-21. So it is most likely a **real runner's account** (or a
loaner radio previously issued to one), not a fleet identity. Whose radio it is determines
the remediation and needs Kurt's knowledge.

This is an **authz hole, not just a UX gap**: any authenticated user who submits a nodeId
that already exists can overwrite that radio's `publicKey`/`privateKey` and flip
`verified: true` on someone else's authoritative row. Two radios in the same batch have
adjacent node nums (`!4358fdc0` / `!4359d0cc` both exist, different owners), so collisions
here are not hypothetical — guessing is cheap.

**Fixes required:** (a) reject or explicitly re-assign on owner mismatch — never silently
patch another user's row; (b) distinguish "created" from "adopted an existing radio" in the
UI instead of rendering both as success; (c) decide the re-flash-of-a-transferred-radio
policy (ownership transfer needs the OTP device-verification path, not a bare flash POST).
**Remediation for the live row `!4359d0cc` is pending Kurt's decision.**

## Status 2026-07-29 22:0xZ — hole 0 FIXED in PR #1087 (open, not merged, not deployed)

Branch `fix/mesh-radio-ownership-transfer`, based on `origin/main`. Same owner → unchanged
`{updated:true}`, no quota charge. Different owner → **explicit audited transfer**: `userId`
and the byUser GSI move atomically, the NEW owner's quota is charged (403 when out, victim's
row untouched), `previousUserId`/`transferredAt` written, `verifiedAt` re-stamped, previous
owner's verification secrets dropped, `{transferred:true}` returned, reassignment logged
ids-only, and a distinct line renders on the Done step so it can never be silent again.
run.human 1031 tests pass, run.flash 74 pass; non-vacuity proven by reverting the fix
(2 entity + 5 route tests fail, all green again with it restored).

⚠️ **ALSO FIXED — pre-existing key-material leak.** `apps/run.flash/webapp/src/app/api/register-radio/route.ts:59`
logged `JSON.stringify(data)` of the whole run.human response. `safeRadio()` strips only
`verificationCode`, so `privateKey`/`publicKey` rode along — **every radio registration was
writing the device's X25519 private key into CloudWatch.** Now logs outcome only.
**Open remediation question for Kurt: existing CloudWatch logs still contain those private
keys** — decide whether to purge the affected log streams and/or treat the exposed device
keys as compromised.

Corrections to earlier analysis in this file, established while fixing:
- The claim that `MeshRadio.patch()` **cannot** move `userId` because it is a byUser GSI
  composite is **FALSE**. ElectroDB v3.7 `patch().set({ userId })` moves it and recomputes
  `gsi1pk` in one atomic `UpdateItem`. The `PatchMeshRadioInput` exclusion was a *policy*
  comment, not a capability limit — and plausibly what caused the original bug. The fix uses
  `patch` (preserves every field by construction, carries `attribute_exists(pk)` so a
  transfer can never create a row) rather than a full-item `put`.
- A **third** stale file existed on the release branch beyond the two identified:
  `apps/run.flash/webapp/src/lib/copy-snapshot.json` (+5/-2 on origin/main) — the exact file
  the i18n work needed. Editing from the stale HEAD would have reverted it.

Deliberately left alone: the old owner's quota is not restored on transfer (fairness nit —
Kurt's call); `syncKeys` also transfers, consistent with the physical-possession rationale
but not flash-only; the user-facing `/api/meshtastic-radios` POST/PATCH/resend routes were
audited and **already** gate on `radio.userId !== session.user.id` — the internal route was
the only hole.

## Operational note — where the welcome/OTP poller actually logs

The welcome + OTP poller is **not** in the proxy's log group. It logs to
`/ecs/run-mqtt-ghosts-run-mqtt-use1-dc34` (the *ghosts* service), and its tick is **20s**.
Searching `/ecs/run-mqtt-meshtk-*` for "welcome" returns nothing. Also: a single PKI DM fans
out to **every** connected client socket for that node (observed: one message id delivered to
three sockets for `!174e59c8`), so a human may see one welcome appear several times across
their devices — that is fan-out, not a re-send. `enqueueWelcome` fires on *every* successful
registration including re-flash, so a second DM after a re-Configure is by design. There IS a
latent at-least-once window (send → best-effort delete; `attempts` only increments on send
failure, so a successful-send-with-failed-delete is indistinguishable from never-attempted),
but no evidence it has fired — no `delete sent welcome … failed` lines observed.

## The four holes, worst first

1. **No server-side reconciliation anywhere.** A configured-but-unregistered radio connects
   fine (the creds are the *user's* and valid) and publishes traffic, but nothing ever creates
   its row. meshtk is strictly read-only against MeshRadio: `keycache/store.go:82` is a
   projecting `GetItem` (miss → `ErrNotFound` → configured fallback key), and NODEINFO-observed
   pubkeys live only in a process-local `sync.Map` (`mqtt/observed_pubkey.go:17`), never
   persisted. The one meshtk write, `MarkRadioCodeSent` (`otpqueue/store.go:184`), is guarded
   `attribute_exists(pk)` specifically so it cannot mint an orphan half-row. **This is Kurt's
   symptom.** Fix = reconcile from first MQTT contact: resolve the MQTT username → RunUser and
   upsert from the observed NODEINFO pubkey with `source:"mqtt-reconcile"`, `verified:false`,
   **no privateKey** (only the flash session ever holds that). Mind node-id canonicalization
   and the MAC-derived-vs-node-id trap (`!435990e4` was a MAC, not a node).
2. **A failed registration POST does not fail the wizard.** Caught locally →
   `setRegistrationStatus({state:"failed"})` (`use-configure.ts:221`/`:226`) while configure
   still reports `stage:"complete"` (`:233`). Recovery is manual only — the retry button
   (`retryRegistration`, `:261`, UI at `wizard-container.tsx:212`) or "Sync keys" (`:295`),
   both reading an **in-memory** `registrationInfoRef` (`:195`). No auto-retry, no backoff,
   no persistence. Fix = persist to localStorage keyed by nodeId, auto-retry with backoff,
   re-offer on next visit, and make a failed registration visibly block the done state.
3. **Tab closed mid-configure orphans it permanently.** `beforeunload` guards cover only the
   *flash* phase (`use-flash-esp32.ts:199`, `use-flash-nrf52.ts:165`), not
   configure/registration; unmount just disconnects (`use-configure.ts:386-392`).
4. **Inconclusive read-back is fail-open with empty keys.** A positive *mismatch* correctly
   throws (`lib/meshtastic.ts:491`) so registration never fires, but an *unreadable* read-back
   proceeds (`lib/verify-config.ts:119`); if only the keys are unreadable, `privateKey`/
   `publicKey` go out as `""` and the server still creates the row (the `undefined` check
   passes on `""`). Result: a row with empty key material that can't serve the decrypt
   firewall or OTP DMs. Fix = reject empty key material on create (or mark `verified:false`)
   and have the client treat unreadable keys as "sync keys required".

Missing nodeId is handled correctly today: status `skipped`, nothing written
(`use-configure.ts:194`/`:229`).

Other create/patch funnel for context: the user-facing self-service route
`apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts:196` (manual add + OTP verify
at `:279`/`:319`). `/api/internal/mesh-map` is read-only.
