# Authoritative Meshtastic Pubkeys in DynamoDB (meshtk decrypt firewall)

**Status:** Design — awaiting review
**Date:** 2026-07-18
**Related:** [`meshtk-proxy-nodes-json-spec.md`](./meshtk-proxy-nodes-json-spec.md) (PR #806), ghost-chatbot PKI reply saga
**Repos touched:** this monorepo (`run.flash`, `run.human`, DDB schema) **and** `~/working/meshtk` (decrypt path, DDB lookup). Per repo convention, meshtk code changes land on meshtk `main`, not the in-repo `apps/run.mqtt/meshtk` symlink.
**Precon context:** nothing is in production — this is precon, mostly test data. **Migrations are one-off scripts we run**, not gated production rollouts. So the embedded-list → entity cutover can be a single backfill + hard switch, and meshtk can go DDB-authoritative aggressively (the `nodes.json` fallback below is a convenience during bring-up, not a long-lived compatibility layer).

---

## 1. Motivation — the incident

ghost-ricky-00 (a chatbot ghost) failed to decrypt every DM from KPH's radio with `authentication failed: MAC verification failed`. After proving ricky's keypair, crypto (X25519), and KPH's phone were all correct, the root cause was:

- **KPH re-flashed his radio, which regenerated its X25519 keypair** (new pubkey `0x1d1ddf4a…`).
- The `nodes.json` feed meshtk uses for decrypt was **pinned to his OLD key** (`0x752bd9dc…`), learned long ago from a broadcast NODEINFO and never refreshed.
- meshtk fetched the stale key from the feed → computed the wrong shared secret → MAC failure, in both directions.

It was corrected live by **injecting a NODEINFO** carrying KPH's real key onto the broker — which exposed a second problem: **that injection used the shared `ghosts` MQTT cred and meshtk trusted it unconditionally.** Anyone with any MQTT publish access can assert any node's pubkey.

### Two failure modes, one root
meshtk learns decrypt keys from **unauthenticated broadcast NODEINFO** (`nodes.json`):

1. **Staleness** — no authority, no refresh; a re-keyed radio serves a wrong key indefinitely.
2. **Poisoning** — any MQTT publisher can assert any node's pubkey, enabling wrong-key DoS or MITM.

## 2. Key insight — the authoritative key already exists in DDB

- `RunUser.meshtasticRadios[]` already stores per-radio `{nodeId, privateKey, publicKey, verified, verificationCode, …}` (`apps/run.human/webapp/src/entities/run-user.ts:87-107`).
- **run.flash already reads the device's real on-device X25519 pubkey** from `SECURITY_CONFIG` over Web Serial and persists it to DDB via run.human's internal API (`apps/run.flash/webapp/src/lib/meshtastic.ts:514-570, 605-671` → `POST /api/register-radio` → `POST /api/internal/meshtastic-radios`, fields `{oidcSub, nodeId, privateKey, publicKey}`).
- **meshtk simply doesn't use it.** Its decrypt path (`~/working/meshtk/internal/mqtt/crypto.go:FetchPublicKeyFromDefcon`) reads broadcast `nodes.json`; its DDB layer (`~/working/meshtk/internal/credcache/`) only `Scan`s for `mqttUsername/mqttPassword` and never touches `publicKey`.

So this is **not a new subsystem** — it is pointing meshtk's decrypt at the authoritative key run.flash already captured.

## 3. Goals / non-goals

**Goals (this spec — "Layer 1" + Sync-keys):**
- **Minimize DDB load by design (overriding constraint).** The in-memory cache is the primary path; DDB is read at most **~once per node per TTL (1–2 min)**, shared across the *entire* ghost fleet in-process — never per-packet, never per-client. Up-to-TTL key staleness is explicitly acceptable in exchange for near-zero steady-state DDB reads. Every design choice below is subordinate to this.
- meshtk resolves a sender's decrypt pubkey from **DDB (authoritative), cache-first**, not from broadcast `nodes.json`.
- Provide a fast `nodeId → publicKey` lookup in DDB (direct key `get`, never `Scan`).
- A **"Sync keys"** action in run.flash to re-register a re-flashed/re-keyed device (reusing the existing read-back + register step).
- Close **pubkey poisoning** for enrolled radios (DDB writes require run.flash's authenticated session + internal secret; MQTT cannot write DDB).

**Non-goals (documented follow-ons):**
- **Layer 2 — cred↔node ACL binding** ("MQTT creds must match the radio"): broker ACLs scoping each cred to its registered nodes' topics + meshtk verifying `sender node ∈ publishing cred's radios`. Defends against *traffic* spoofing. Deferred, see §9.
- Retiring `nodes.json` / meshobserv entirely (that is PR #806's scope; this spec only removes meshtk's *decrypt-key* dependency on it).
- Changing the ghost fleet's own keys (those load from `nodes.ghost.*.json`, not DDB).

## 4. Design

### 4.1 Data model — promote radios to a first-class `MeshRadio` entity
**Decision (review):** radios are promoted from the embedded `RunUser.meshtasticRadios[]` list to a **first-class ElectroDB entity** keyed by `nodeId` (single source of truth, natively indexable — no nested-list GSI problem). This replaces the earlier denormalized-lookup-item idea.

New `MeshRadio` entity on the shared `ELECTRO_TABLE`:

| Attribute | Notes |
|---|---|
| `nodeId` | `!hex` node id — **primary pk** (direct `GetItem`/`get` by meshtk and app) |
| `nodeNum` | uint32 form (meshtk keys packets by node number; store both to avoid `!hex`↔int conversion bugs at the lookup boundary) |
| `userId` | owning RunUser — **GSI `byUser` pk** (list a user's radios; admin; Layer 2 cred↔node join) |
| `publicKey` | authoritative X25519 pubkey, stored as **`0x` hex** (see below) |
| `privateKey` | as today (device-supplied; retained for parity with current model) |
| `verified`, `verificationCode`, `verifiedAt`, `verificationAttempts`, `resendAttempts` | migrated from `meshtasticRadios[]` |
| `impersonate`, `showOnMap` | migrated |
| `source` | `flash` \| `sync` \| `manual` (provenance) |
| `createdAt`, `updatedAt` | timestamps |

**Encoding:** `publicKey` is stored **`0x` hex**, matching its point of *use* — meshtk's crypto (`ParseHexKey`, X25519) and the existing `nodes.json` convention. run.human converts the device's base64 → `0x` hex once, at the `register-radio` write boundary.

**GSIs:** `byUser` (pk `userId`) for per-user listing, admin, cleanup, and the deferred Layer 2 cred↔node join. meshtk's hot path is a **direct key `get` on `nodeId`/`nodeNum`** — no GSI on the hot path.

**Migration:** one-off backfill of every existing `RunUser.meshtasticRadios[]` entry into a `MeshRadio` item; then redirect all readers/writers (below) to the entity and retire the embedded list. This is the larger part of the change — see §8 / §8a. (Precon test data → a single backfill + hard switch is fine.)

### 4.2 Write path
Single write path stays `register-radio`:
- `POST /api/internal/meshtastic-radios` upserts the **`MeshRadio` entity** (keyed by `nodeId`, `userId` from the resolved RunUser), converting the device base64 pubkey → `0x` hex.
- **Consumer migration:** redirect the user-facing add/update (`apps/run.human/webapp/src/app/api/meshtastic-radios/route.ts`, incl. `derivePublicKey`), any UI reading `meshtasticRadios[]`, and `updateMeshtasticRadios` to the entity (or a query returning the user's `MeshRadio` items via `byUser`). Retire the embedded list once all readers move.
- **Backfill script:** create a `MeshRadio` item from every existing `RunUser.meshtasticRadios[]` entry before flipping readers.

### 4.3 "Sync keys" (re-key path)
- New button/step in run.flash that runs **only** the existing read-back (`requestSecurityKeys` / `onConfigPacket` security variant) + `register-radio` POST — no full re-provision.
- Handles the reflash-regenerates-keys case: user reflashes → copies config → **Sync keys** → DDB updated with the new device pubkey.

### 4.4 meshtk decrypt read path (core change)
- In `~/working/meshtk/internal/mqtt/crypto.go`, replace the sender-pubkey source in `decryptPKI` from `FetchPublicKeyFromDefcon` (nodes.json) with a **DDB `MeshRadio` lookup by sender nodeNum/nodeId**.
- **Cache-first**, mirroring `internal/credcache/` (`CacheAuthenticator`: in-memory cache + `singleflight` dedup + circuit breaker + negative caching). New `internal/keycache/` alongside `credcache/`, or a generalization of it. Use `GetItem`/`get` (not `Scan`) since we key by `nodeId`.
- **One process-wide shared cache across the whole ghost fleet** (like the existing `pubKeyCache sync.Map`), so the ~34 in-process clients collectively cause **at most one DDB read per node per TTL**, independent of packet or client volume. `singleflight` collapses concurrent misses for the same node into a single read; **negative caching** bounds DDB reads for unknown/unenrolled senders too.
- **Cache TTL: 1–2 minutes** — bounds re-key propagation (a Sync-keys update is picked up within one TTL) while keeping DDB reads to a trickle. Prefer plain TTL expiry over write-driven invalidation (no extra read/coordination); only add `updatedAt`-based invalidation if a faster refresh is ever needed.
- Config wiring parallels `Server.CredCache.{TableName,TableRegion,DynamoDBEndpoint}` (`~/working/meshtk/internal/app/server/cmd.go:76-79`).

### 4.5 Transition / fallback flag
- **DDB-first.** On a DDB miss, behavior is flag-controlled:
  - `fallback = nodes.json` (rollout default) — un-enrolled senders still decrypt; **poisoning still possible for those**.
  - `fallback = none` (target) — miss → NACK (existing `nackHandler`, prompts a NodeInfo/enrollment); **fully closes poisoning**.
- Flip to `none` once real radios are enrolled/backfilled. Log every fallback so we can measure enrollment coverage before flipping.

### 4.6 Relationship to `nodes.json` (out of scope here)
This spec does **not** generate or write `nodes.json`. `nodes.json` remains the **map feed** (positions, telemetry, presence for gpx.defcon.run), produced by meshobserv today / the PR #806 proxy tomorrow. What changes: `nodes.json` **stops being a key-trust anchor** — meshtk reads decrypt pubkeys from DDB. Consequently its `pubkey` field becomes redundant-for-decrypt and should be **sourced from DDB or dropped** by the generator; that is a **handoff to #806**, not built here. The two specs are complementary: #806 decides where `nodes.json` comes from; this one removes the security-sensitive key role from it entirely.

## 5. Data flow

```
Provision / Sync keys (run.flash, Web Serial)
  read SECURITY_CONFIG pubkey  ->  POST /api/register-radio
     -> run.human POST /api/internal/meshtastic-radios (x-internal-secret)
        -> upsert RunUser.meshtasticRadios[]   (unchanged, user source of truth)
        -> upsert MeshRadio{nodeId,nodeNum,userId,publicKey,verified}  (NEW)

Decrypt (meshtk ghost/proxy)
  incoming PKI packet from node N
     -> keycache.Get(N)  (in-memory -> GetItem MeshRadio by N -> cache)
        hit  -> X25519(recipient_priv, N.publicKey) -> AES-CCM -> plaintext
        miss -> [flag] nodes.json fallback  OR  NACK
```

## 6. Error handling / edge cases
- **DDB miss (un-enrolled sender):** per fallback flag (§4.5).
- **Unverified radio (`verified=false`):** decrypt still uses the key (decrypt ≠ authorization); verification gates other features, not key resolution. Document explicitly.
- **Non-user senders (random mesh nodes, other ghosts):** never in `MeshRadio`; rely on fallback during transition. Ghost↔ghost uses in-process config keys, unaffected.
- **Stale cache after Sync keys:** bound cache TTL (mirror credcache) so a re-key propagates within one TTL; optionally invalidate on `register-radio` write via a version/updatedAt check.
- **nodeId vs nodeNum:** meshtk keys by uint32 node number; store `nodeNum` explicitly to avoid `!hex`↔int conversion bugs at the lookup boundary.

## 7. Testing
- **Unit (meshtk):** keycache hit/miss/negative/singleflight/circuit-breaker (port credcache tests); `decryptPKI` uses DDB key; fallback flag both ways.
- **Unit (run.human):** `register-radio` upserts the `MeshRadio` entity (base64→hex); one-off backfill script correctness.
- **Integration:** provision a device (or fixture) → `MeshRadio` written → meshtk decrypts a real PKI packet against the DDB key. Re-key → **Sync keys** → meshtk decrypts against the new key.
- **Security regression:** a NODEINFO injected on the broker with a bogus pubkey (the exact exploit used to hotfix) must **not** change decrypt behavior when `fallback=none`.
- **Verify against the live incident:** with KPH's real key in `MeshRadio`, ricky decrypts a KPH DM with `nodes.json` ignored.

## 8. Rollout (precon — one-off, no gating)
1. Add `MeshRadio` entity (+ `byUser` GSI). Run a **one-off backfill** from every `RunUser.meshtasticRadios[]`, then switch all readers/writers to the entity and drop the embedded list (test data — no dual-read window needed).
2. Point `register-radio` at the entity (base64→`0x` hex). Add run.flash **Sync keys**; re-Sync the test radios (incl. KPH).
3. Ship meshtk `keycache` DDB-first. Keep `fallback=nodes.json` only briefly during bring-up, then flip `fallback=none` → poisoning closed. Retire the live injection stopgap.

## 8a. Risk
Main care point is the **`meshtasticRadios[]` → `MeshRadio` cutover** — enumerate every reader of the embedded list during planning so none is missed. Low stakes given test-only data and one-off backfill; a mistake is re-runnable. meshtk's decrypt change is small and independently testable behind the fallback flag.

## 9. Follow-on — Layer 2 (cred↔node binding, deferred)
Prevents *traffic* spoofing (publishing packets as another node), not just key poisoning:
- Broker ACLs scope each MQTT cred to publish only on its **registered nodes'** topics (`msh/US/2/e/dc.run/!<node>`). Requires a DB/node-aware ACL (a cred → its `MeshRadio` node set). Note the **multiple-radios-share-one-cred** constraint: a cred authorizes a *set* of nodes.
- meshtk verifies `sender node ∈ publishing cred's radios` at decrypt.
- The `MeshRadio.userId` GSI (`byUser`) is the join that makes this cheap — designed in now, enforced later.

## 10. Resolved decisions
- **Pubkey encoding:** `0x` hex in `MeshRadio`, converted from device base64 at the `register-radio` write boundary — consistent with meshtk crypto's point of use. (§4.1)
- **Data model:** promote radios to a first-class `MeshRadio` entity keyed by `nodeId`, GSI `byUser` — not a denormalized lookup item. (§4.1)
- **keycache TTL:** 1–2 minutes. (§4.4)
- **`nodes.json` generation:** out of scope; handoff to #806. (§4.6)

## 11. Remaining open question
- Whether to keep any denormalized copy of radios on `RunUser` for legacy UI reads during the migration window, or move all reads to `MeshRadio` in one step (depends on how many UI surfaces read `meshtasticRadios[]` — to be enumerated during planning).
