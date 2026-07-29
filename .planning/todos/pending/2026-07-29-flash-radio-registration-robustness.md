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
