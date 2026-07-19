# Phase 66: Authoritative Meshtastic Pubkeys in DynamoDB (meshtk decrypt firewall) - Research

**Researched:** 2026-07-18
**Domain:** ElectroDB entity modeling (run.human), Web Serial provisioning (run.flash), Go DynamoDB cache-first read path + X25519/AES-CCM decrypt (meshtk)
**Confidence:** HIGH (all touchpoints read at file:line from source this session; spec is approved and unambiguous)

## Summary

This is a **mapping-and-wiring phase, not a design phase** — the spec (`docs/authoritative-pubkey-ddb-design.md`) is approved with resolved decisions (§10) and one open question (§11). Every claim below is anchored to a file:line read this session. The three pieces are cleanly separable and independently testable.

The single biggest landmine is **pk/sk parity**: meshtk (Go) must construct a DynamoDB `GetItem` key byte-identical to what ElectroDB writes for a `MeshRadio` item. meshtk today has **no `GetItem` precedent** — `credcache` only ever `Scan`s (confirmed `internal/credcache/store.go:63-106`). But the monorepo already has the exact pattern to mirror: `src/entities/__tests__/qr-key-parity.test.ts` locks the run.qr resolver Lambda's raw-client reads to ElectroDB's composed keys. The ElectroDB v3.5 key format is confirmed from those tests: **pk = `$run#<attr>_<lowercased-value>`, sk = `$<entity>_<version>`**. For `MeshRadio` keyed by `nodeId`: `pk="$run#nodeid_!433d1cec"`, `sk="$meshradio_1"`.

The second landmine is **nodeId zero-padding inconsistency** between write paths (flash pads hex to 8, manual-add does not) — meshtk composes the pk from a uint32 nodeNum and must match the stored string exactly. Recommendation: canonicalize `nodeId` to `!` + lowercase-hex-padded-to-8 at the `MeshRadio` write boundary.

**Primary recommendation:** DUAL-WRITE (keep `RunUser.meshtasticRadios[]` as the user-facing denormalized copy, add a `MeshRadio` entity alongside every key-affecting write) rather than retiring the embedded list. Enumeration shows the list backs a full CRUD UI whose verification/resend/quota state `MeshRadio` does not model; dual-write yields zero user-facing regression surface and matches the repo's existing denormalization pattern (checkInCount, activityScore rollups). This is the §11 decision and should be sign-off-confirmed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Authoritative pubkey storage | Database (DynamoDB `run-human-electro`) | — | Single source of truth; both run.human writes and meshtk reads target it |
| Device pubkey capture | Browser / Client (run.flash Web Serial) | Frontend Server (run.flash `/api/register-radio` proxy) | Only the browser can talk to the USB radio; the proxy attaches the authenticated OIDC sub + internal secret |
| Pubkey write (base64→hex) | API / Backend (run.human `/api/internal/meshtastic-radios`) | — | Server-to-server internal secret boundary; conversion happens once here |
| Decrypt-key resolution | Backend service (meshtk ghost/proxy, in-process) | Database (GetItem on miss) | In-memory keycache is primary; DDB is the authoritative backstop at ≤1 read/node/TTL |
| User-facing radio CRUD | API / Backend (run.human `/api/meshtastic-radios`) | Browser (MeshtasticRadios.tsx) | Verification/resend/quota flow — unchanged by this phase under dual-write |

## User Constraints (from spec — no CONTEXT.md present)

### Locked Decisions (spec §10)
- Pubkey encoding: **`0x` hex** in `MeshRadio`, converted from device base64 at the `register-radio` write boundary.
- Data model: first-class **`MeshRadio` ElectroDB entity keyed by `nodeId`**, GSI `byUser` — not a denormalized lookup item.
- keycache TTL: **1–2 minutes**, plain expiry (not write-invalidation).
- `nodes.json` generation: **out of scope** (handoff to PR #806).

### OVERRIDING CONSTRAINT
Keep DDB load minimal. In-memory keycache is the primary path; DDB read at most ~once per node per TTL, shared **process-wide** across the ~34-client ghost fleet — never per-packet, never per-client. singleflight + negative caching + circuit breaker. Direct `GetItem` by nodeId/nodeNum, never `Scan`. Up-to-TTL key staleness is acceptable.

### Out of Scope
- Layer 2 cred↔node ACL binding (traffic-spoofing defense, spec §9).
- Retiring/generating `nodes.json` from DDB (PR #806).

### Open Question (spec §11 — MRAD-04)
Whether to retire the embedded `meshtasticRadios[]` list (full reader migration) or keep it as a denormalized user-facing copy (dual-write). **Decided by enumeration below → recommend dual-write.**

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MRAD-01 | `MeshRadio` ElectroDB entity, pk `nodeId`, `byUser` GSI | §"ElectroDB entity pattern" — clone `accomplishment.ts`; GSI maps onto existing `gsi1pk-gsi1sk-index` (no new physical GSI) |
| MRAD-02 | `register-radio` writes entity, base64→`0x` hex | §"Write-path touchpoints" — conversion at `internal/meshtastic-radios/route.ts` MeshRadio upsert |
| MRAD-03 | Idempotent re-runnable backfill script | §"Backfill script" — clone `scripts/migrate-ctf-answerhash.mts` |
| MRAD-04 | Enumerate readers/writers; decide migrate vs dual-write | §"Reader/writer enumeration" — recommend dual-write |
| MRAD-05 | run.flash "Sync keys" (read-back + register only) | §"run.flash Sync keys" — new handler in `use-configure.ts` cloning `retryRegistration` + `requestSecurityKeys` |
| MRAD-06 | meshtk `internal/keycache` (cache-first, singleflight, negative, circuit breaker, TTL, GetItem) | §"meshtk keycache" — mirror `internal/credcache/` |
| MRAD-07 | `decryptPKI` resolves from keycache + fallback flag | §"meshtk keycache" — TWO call sites (crypto.go:55 decrypt AND fleet/cmd.go:223 reply) |
| MRAD-08 | Terraform `byUser` GSI if managed; keycache config wiring | §"ElectroDB entity pattern" — GSIs terraform-managed but generic gsi1/2/3 already exist → **no terraform change needed**; config parallels `CredCacheConfig` |

---

## 1. Reader/writer enumeration table — `RunUser.meshtasticRadios[]`

**Scope of grep:** `apps/ scripts/` (covers run.human, run.flash, run.mqtt, run.auth, run.gpx). **Every hit is inside `run.human`.** No other app reads the embedded list directly (run.flash writes via HTTP; meshtk reads via nodes.json/Scan; run.gpx reads via the `/api/internal/mesh-map` internal API, not the list).

| # | File:line | R/W | Description |
|---|-----------|-----|-------------|
| 1 | `run.human/webapp/src/entities/run-user.ts:87-107` | DEFN | Embedded `meshtasticRadios` list attribute (map items enumerated below) |
| 2 | `run-user.ts:352-357` `updateMeshtasticRadios()` | **WRITE** | Sole write helper: `RunUser.patch({userId}).set({meshtasticRadios})`. All mutations funnel here |
| 3 | `run-user.ts:449-462` `type MeshtasticRadio` + `:471-486` `sanitizeRadio()` | TYPE/helper | Shape + read-back sanitizer (empty-string→NULL guard) |
| 4 | `run-user.ts:300-306` `scanAllRunUsers()` | READ (indirect) | Full-table scan; type reconcile mentions the field; used by mesh-map |
| 5 | `run-user.ts:502` `RunUserItem.meshtasticRadios?` | TYPE | External contract type |
| 6 | `api/internal/meshtastic-radios/route.ts:79,110-125` | READ+**WRITE** | Internal register from run.flash: reads current, upserts by nodeId, writes via #2. **base64→hex conversion point for MeshRadio (MRAD-02)** |
| 7 | `api/meshtastic-radios/route.ts:72` (GET) | READ | Returns `user.meshtasticRadios` to UI |
| 8 | `api/meshtastic-radios/route.ts:126,142-157` (POST) | READ+**WRITE** | User adds a radio; `derivePublicKey` at :13-32 |
| 9 | `api/meshtastic-radios/route.ts:196,203,249-251` (PATCH) | READ+**WRITE** | Verify code / update keys / impersonate / showOnMap |
| 10 | `api/meshtastic-radios/route.ts:288-297` (DELETE) | READ+**WRITE** | Remove a radio |
| 11 | `api/meshtastic-radios/resend/route.ts:30,66-68` | READ+**WRITE** | Resend verification code (does NOT touch keys) |
| 12 | `api/internal/mesh-map/route.ts:35-44` | READ | Map feed: emits `{nodeNum,displayName,...}` for verified+showOnMap radios. Consumed by run.gpx rabbit proxy. `hexToNodeNum` at :16-18 |
| 13 | `api/user/route.ts:40,80-99` | READ (implicit) | `getRunUser` → spreads `...safeUserData` → `meshtasticRadios` carried to whoami UI (not referenced by name; hence absent from grep but **live on the wire**) |
| 14 | `whoami/page.tsx:46,420` | READ (UI) | `userData?.meshtasticRadios` passed as `radios` prop |
| 15 | `components/profile/MeshtasticRadios.tsx:31-62,126-350` | READ (prop) + calls #7-11 | Full CRUD client component (add/verify/resend/delete/toggle) |
| 16 | `api/internal/mesh-map/route.test.ts:28` | TEST fixture | — |
| 17 | `entities/run-user.test.ts` | TEST | `sanitizeRadio` unit tests |

**Key-affecting write sites (must mirror to `MeshRadio` under dual-write):** #6 (internal register), #8 (user add), #9 (user PATCH when privateKey/publicKey change), #10 (DELETE → remove MeshRadio). #11 resend and verification-only PATCH do not change keys but *could* sync the `verified` flag (nice-to-have, not required for decrypt).

### MRAD-04 recommendation: **DUAL-WRITE** (keep embedded list, add `MeshRadio` alongside)

**Rationale:**
- **Lowest user-facing regression surface.** The embedded list backs a rich CRUD UI (verification codes, resend attempts, quota consumption, impersonate/showOnMap toggles). `MeshRadio` models the *decrypt* fields, not the *verification-flow state* (`verificationCode`, `resendAttempts` are UI-flow, not key data). Retiring the list forces rewriting GET (#7), POST/PATCH/DELETE (#8-10), resend (#11), `/api/user` spread (#13), and the whoami prop wiring (#14) — every one a regression opportunity for zero decrypt benefit.
- **Matches the repo's established pattern.** RunUser already carries denormalized rollups (`checkInCount`, `activityScore`, `activityCounts`) alongside source-of-truth entities (CheckIn, Accomplishment). `MeshRadio` as the decrypt-authoritative mirror of the UI-authoritative embedded list is the same shape.
- **Satisfies the OVERRIDING low-risk posture.** meshtk reads only `MeshRadio`; the app UI is untouched. The one new invariant is disciplined and testable: the 4 key-affecting write sites also upsert/delete `MeshRadio`.
- **Spec-consistent.** The spec's §4.1/§8 hard-switch language is explicitly reopened by §11 ("depends on how many UI surfaces read `meshtasticRadios[]`"). Enumeration = ~9 read sites incl. the whole whoami UI → dual-write is the enumeration-driven answer.

**The hard-switch (retire list) alternative** is viable for precon test data (§8a "a mistake is re-runnable") and is the spec author's stated lean. If chosen, it is strictly more work (rewrite all of #7-15) with a real UI-regression surface. **Flag for human sign-off** (see Open Questions).

### `MeshtasticRadio` embedded map fields (run-user.ts:92-104) — every field
`id`(string), `nodeId`(string), `privateKey`(string), `publicKey`(string), `impersonate`(bool), `showOnMap`(bool), `verificationCode`(string), `verified`(bool), `createdAt`(number), `verifiedAt`(number), `verificationAttempts`(number), `resendAttempts`(number).

Maps to MRAD-01 `MeshRadio` attrs: `nodeId`(pk), `nodeNum`(NEW, uint32), `userId`(NEW, GSI pk), `publicKey`(→`0x`hex), `privateKey`, `verified`/`verificationCode`/`verifiedAt`/`verificationAttempts`/`resendAttempts`, `impersonate`, `showOnMap`, `source`(NEW: `flash`|`sync`|`manual`), `createdAt`/`updatedAt`. (Embedded `id` uuid is not needed on the entity — `nodeId` is the natural key.)

---

## 2. ElectroDB entity pattern (MRAD-01, MRAD-08)

### Exact template to clone: `src/entities/accomplishment.ts`
Read fully this session. It is the canonical GSI-bearing entity on the shared table:
- Imports `electroClient, ELECTRO_TABLE` from `./client` (accomplishment.ts:2).
- `model: { entity: "Accomplishment", version: "1", service: "run" }` (:30-34) — MeshRadio uses `entity: "MeshRadio", version: "1", service: "run"`.
- `indexes.primary` = `pk field "pk" composite [key]`, `sk field "sk" composite [id]` (:120-129).
- `indexes.byType` / `byYear` map onto **physical generic GSIs** `gsi1pk-gsi1sk-index` / `gsi2pk-gsi2sk-index` (:130-151). Comment at :23-25 confirms **ElectroDB auto-scopes GSIs by entity, so sharing the physical gsi1/gsi2 indexes across entities is safe.**
- Entity export closes with `{ client: electroClient, table: ELECTRO_TABLE }` (:154).
- `createdAt` default + `updatedAt` `watch:"*"` auto-timestamp pattern (:107-117).

### MeshRadio index declaration
```
indexes: {
  primary: { pk: { field: "pk", composite: ["nodeId"] }, sk: { field: "sk", composite: [] } },
  byUser:  { index: "gsi1pk-gsi1sk-index", pk: { field: "gsi1pk", composite: ["userId"] }, sk: { field: "gsi1sk", composite: ["nodeId"] } },
}
```
(Choose a free physical GSI slot — see below. RunUser uses gsi1 for `byHash`; Accomplishment uses gsi1/gsi2. Because ElectroDB scopes by entity, MeshRadio may reuse `gsi1pk-gsi1sk-index` without collision. gsi3 is also free at the table level if isolation is preferred.)

### GSI slot / terraform (MRAD-08): **NO terraform change needed**
- The shared `run-human-electro` table is terraform-managed via `infra/terraform/modules/dynamodb/v1.0.0/main.tf`.
- The `electro` table_type schema (main.tf:24-53) **pre-provisions three generic GSIs**: `gsi1pk-gsi1sk-index`, `gsi2pk-gsi2sk-index`, `gsi3pk-gsi3sk-index` (all projection ALL).
- ElectroDB overlays entity-scoped logical indexes onto these physical GSIs. `MeshRadio.byUser` maps onto an existing physical GSI → **no `global_secondary_index` block to add.** Document this in RESEARCH/PLAN: MRAD-08's "if terraform-managed" branch resolves to "already provisioned; app-managed overlay; no infra change."
- Table name/region: `RUN_ELECTRO_DBNAME` default `run-human-electro` (client.ts:52), region `RUN_DYNAMODB_REGION`. **Matches meshtk's `CredCacheConfig.TableName` default `run-human-electro` / `TableRegion us-east-1`** (`~/working/meshtk/pkg/config/config.go:52-56`). ✔ Same table.

### Confirmed ElectroDB v3.5 key format (from `__tests__/qr-key-parity.test.ts`)
- `electrodb ^3.5.0` (package.json).
- pk = `$run#<attr>_<lowercased-value>` — e.g. `$run#code_bunny`, `$run#challenge_sao`, `$run#owner_kurt`, `$run#nonce_n-abc`.
- sk = `$<entity>_<version>` — e.g. `$qr_1`, `$ctf_1`, `$ctfpending_1`; composite sk appends `#<attr>_<val>` (`$qrstat_1#bucket_total`).
- **Values are lowercased** in the composite (`BUNNY`→`code_bunny`). `nodeId` `!433d1cec` is already lowercase hex; the `!` is preserved literally.
- **MeshRadio composed keys:** `pk="$run#nodeid_!433d1cec"`, `sk="$meshradio_1"`; byUser GSI `gsi1pk="$run#userid_<userId>"`.

---

## 3. Write-path touchpoints (MRAD-02)

**Single write path stays `register-radio`** (spec §4.2). Flow (all read this session):
```
run.flash use-configure.ts:188 / :253  →  POST /api/register-radio
  run.flash/api/register-radio/route.ts:16-60 (auth + internal secret)
    → POST run.human /api/internal/meshtastic-radios (x-internal-secret)
       run.human/api/internal/meshtastic-radios/route.ts:21-136
         body {oidcSub, nodeId, privateKey, publicKey}   (publicKey is BASE64)
         resolves oidcSub→adapterUserId (GSI1 query :40-62)
         upsert embedded list via updateMeshtasticRadios  (UNCHANGED under dual-write)
         + NEW: upsert MeshRadio entity                    (MRAD-02)
```

### base64 → `0x` hex conversion point (MRAD-02)
- **Where base64 originates:** run.flash `requestSecurityKeys` (`meshtastic.ts:538-548`) does `btoa(String.fromCharCode(...bytes))` on the device's raw X25519 key → base64. Also `configureWithRetry:663-669`. run.flash POSTs base64 (`use-configure.ts:191-195`).
- **Where hex is needed:** meshtk `ParseHexKey` (`crypto.go:78-93`) strips `0x` and `hex.DecodeString` → 32 bytes. nodes.json convention is hex too.
- **Conversion boundary:** in `run.human/api/internal/meshtastic-radios/route.ts`, at the `MeshRadio` upsert. `publicKeyHex = "0x" + Buffer.from(publicKeyBase64, "base64").toString("hex")` (32 bytes → 64 hex chars). The embedded list keeps base64 (unchanged); only `MeshRadio.publicKey` is hex. Guard: reject/skip if decoded length ≠ 32.
- ⚠️ **`derivePublicKey` (`meshtastic-radios/route.ts:13-32`) returns BASE64** — the manual-add path (#8) stores base64 too. Under dual-write, the MeshRadio upsert must convert whatever the write site produced (base64) to hex. If the user-facing POST/PATCH also mirror to MeshRadio, apply the same conversion there.

### nodeId canonicalization at the write boundary
- flash path: `nodeId = "!" + nodeNum.toString(16).padStart(8, "0")` — **padded to 8** (`meshtastic.ts:657`).
- manual-add: `validateAndFormatNodeId` (`meshtastic-radios/route.ts:34-50`) → `!${intValue.toString(16)}` — **NOT padded** (a nodeNum with a leading-zero byte yields <8 hex digits).
- internal route lowercases only (`:80 nodeId.toLowerCase()`).
- **Fix:** canonicalize to `!` + `nodeNum.toString(16).padStart(8,"0")` (lowercase) when writing `MeshRadio.nodeId`, and store `nodeNum` (uint32) explicitly, so meshtk's `fmt.Sprintf("!%08x", nodeNum)` composes the identical pk. See Landmines.

---

## 4. Backfill script (MRAD-03)

### Template to clone: `apps/run.human/webapp/scripts/migrate-ctf-answerhash.mts`
Read this session (:1-60). It is the exact idempotent one-off migration precedent:
- **Runner:** `AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/<name>.mts` (dry-run default) then `--confirm` to write (migrate-ctf-answerhash.mts:44-52).
- **DDB connection:** raw `@aws-sdk/client-dynamodb` + `DynamoDBDocument` (NOT the ElectroDB entity). Reason documented at :12-25 — the ElectroDB `client.ts` imports the ESM-only `@auth/dynamodb-adapter`, which fails under a bare `tsx` CJS run (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Env names mirror the webapp: `RUN_ELECTRO_ID`, `RUN_ELECTRO_SECRET`, `RUN_DYNAMODB_REGION`, `RUN_ELECTRO_DBNAME` (default `run-human-electro`), `RUN_ELECTRO_ENDPOINT` (local).
- **Idempotency pattern:** scan RunUser rows by ElectroDB `__edb_e__` entity marker, write each row by its OWN pk/sk read from the scan — "no key composition, ZERO entity-key drift risk" (:15-16, and `reset-ctf-user.mts:237-255`).

### Backfill-specific twist (key composition IS required here)
Unlike migrate-ctf-answerhash (which rewrites existing rows by their own key), the backfill **creates NEW `MeshRadio` rows** → it must compose the MeshRadio pk/sk. Two safe options, in preference order:
1. **Preferred:** import and use the `MeshRadio` ElectroDB entity via a thin ESM-safe entry (or run under Next's bundler / a `.mjs` that imports the compiled entity) so ElectroDB composes the key — no hand-rolled string. If the ESM-adapter blocker bites, isolate the `MeshRadio` entity behind a client module that does NOT import `@auth/dynamodb-adapter` (MeshRadio only needs `electroClient`, not the authjs adapter).
2. **Fallback:** hand-compose `pk="$run#nodeid_"+nodeId`, `sk="$meshradio_1"`, `gsi1pk="$run#userid_"+userId`, `gsi1sk="$run#nodeid_"+nodeId` and put via raw client — **but this MUST be locked by a key-parity test** (clone `qr-key-parity.test.ts`) so it can never drift from the entity.
- Source: iterate `scanAllRunUsers()` equivalent → for each `u.meshtasticRadios[]` → convert `publicKey` base64→`0x`hex, canonicalize nodeId (pad-8), derive `nodeNum = parseInt(nodeId.replace('!',''),16)>>>0` (same as `mesh-map/route.ts:16-18`), set `source:"manual"` (or `"flash"` where inferable). Idempotent: `MeshRadio.get({nodeId})` first, skip if present (same short-circuit as `accomplishment.ts:310-313`).

---

## 5. run.flash "Sync keys" (MRAD-05)

### Exact handler to clone: `useConfigure().retryRegistration` (`src/hooks/use-configure.ts:247-279`)
`retryRegistration` already does the register-only half (POST `/api/register-radio` from cached `registrationInfoRef`, sets `registrationStatus`). "Sync keys" = `retryRegistration` **plus a fresh device read-back** instead of cached info:
1. Connect to device (Web Serial) — reuse the existing connect path the wizard uses.
2. `requestSecurityKeys(device)` (`meshtastic.ts:514-570`) → `{privateKey, publicKey}` base64 (the SECURITY_CONFIG read-back, `onConfigPacket` security variant). Also need `nodeId` from `onMyNodeInfo` (`myNodeNum` → `!%08x`), same capture as `configureWithRetry:616-621,656-657`.
3. POST `/api/register-radio` with `{nodeId, privateKey, publicKey}` (identical body to :191-195 / :256-260).
   **No `pushDeviceConfig`, no flash, no region push** — spec §4.3 "no full re-provision."

### UI surface: `src/components/done/done-step.tsx`
Renders `registrationStatus` + the retry button via `onRetryRegistration` (`done-step.tsx:50,159-209`; wired from `wizard-container.tsx:190-191`). A **"Sync keys"** button belongs here (or as a distinct lightweight entry that connects → read-back → register without walking the flash/configure wizard). The hook exposes state via `UseConfigureReturn` (`use-configure.ts:39,58,312-314`) — add a `syncKeys()` callback next to `retryRegistration` and surface a button in `DoneStep` (and/or a standalone "already flashed? sync keys" entry on the wizard start).

Note: `register-radio` route already enforces `assertNotLockedLive` + session (`register-radio/route.ts:18-26`) — Sync keys inherits that gate for free.

---

## 6. meshtk keycache + decrypt (MRAD-06, MRAD-07)

### Structs to mirror from `internal/credcache/` → new `internal/keycache/`
| credcache (read this session) | keycache analog |
|---|---|
| `CacheAuthenticator` (`auth.go:18-31`): cache + store + `singleflight.Group` + atomic circuit-breaker (`consecutiveFailures`,`lastFailure`,`failureThreshold`,`cooldownDuration`) + `negativeTTL` | `KeyResolver` (same fields) |
| `Verify()` (`auth.go:79-104`): cache.Get → negative short-circuit → `fetchWithSingleflight` | `Resolve(ctx, nodeId/nodeNum) (pubKeyHex string, ok bool, err error)` |
| `fetchWithSingleflight()` (`auth.go:108-137`): `IsDegraded` gate → `sf.Do(key,…)` → `ErrNotFound`→negative `SetWithTTL(negativeTTL)` → `recordFailure/Success` → `cache.Set` | same, verbatim shape |
| `Cache` (`cache.go:19-99`): Otter v2, `ExpiryWriting(ttl)`, `Get`/`Set`/`SetWithTTL`/`Delete`/`Stats` | reuse Otter v2; value type `*Key{ NodeID, NodeNum, PubKeyHex string/uint32, Negative bool }` |
| `DynamoDBStore` (`store.go`): ⚠️ uses **`Scan`+FilterExpression** (`store.go:63-106`) | **REPLACE with `GetItem`** by composed pk/sk — the ONE deliberate divergence |
| `Credential`/`ErrNotFound` (`types.go`) | `Key`/`ErrNotFound` |
| Circuit breaker `IsDegraded/recordFailure/recordSuccess` (`auth.go:155-178`) | copy verbatim |

Defaults (`auth.go:60-68`): failureThreshold 3, cooldown 10s, negativeTTL 60s. TTL 900s in credcache config — **override to 60–120s for keycache** (spec §4.4).

### The `GetItem` store (the divergence — pk/sk parity)
```go
// meshtk keycache store — CONSTRUCT the identical ElectroDB key
nodeId := fmt.Sprintf("!%08x", nodeNum)          // canonical, pad-8, lowercase
key := map[string]types.AttributeValue{
    "pk": &types.AttributeValueMemberS{Value: "$run#nodeid_" + nodeId},
    "sk": &types.AttributeValueMemberS{Value: "$meshradio_1"},
}
// GetItem(TableName=run-human-electro, Key=key, ProjectionExpression="publicKey,nodeNum")
```
Use `dynamodb.GetItem` (add `GetItem` to a `DynamoDBAPI` interface — credcache's interface only declares `Scan`, `store.go:15-17`). Unmarshal `publicKey` (already `0x`hex) → pass straight to `ParseHexKey`.

### Config wiring (MRAD-08): parallel `CredCacheConfig`
`pkg/config/config.go:51-59` defines `CredCacheConfig{TTLSecs,MaxSizeMB,TableName,TableRegion,DynamoDBEndpoint,NegativeTTLSecs}` and `Config.CredCache` (:76). Add a sibling `KeyCacheConfig` (same fields, TTL default 90s) + `Config.KeyCache` + a `Fallback string` (`nodes.json`|`none`, default `nodes.json`). Server wiring parallels `cmd.go:60-93`: build cache+store+resolver in `NewServer`, hang it on `ServerCmd`, thread into the `MqttClient` (see call sites below).

### `decryptPKI` change points — TWO call sites (MRAD-07)
1. **Decrypt:** `internal/mqtt/crypto.go:55` — `senderPubKeyHex, err := c.FetchPublicKeyFromDefcon(packet.GetFrom())`. Replace with `c.keycache.Resolve(packet.GetFrom())`; on miss, branch on the fallback flag: `nodes.json` → existing `FetchPublicKeyFromDefcon`; `none` → return error (→ existing NACK, below).
2. **Reply-encrypt:** `internal/app/fleet/cmd.go:223` — `senderPubKeyHex, err := n.MqttClient[toFleetIdx].FetchPublicKeyFromDefcon(from)` resolves the *recipient* pubkey for `PublishPKIMessage`. Same swap. **Do not miss this one** — decrypt-only migration would still send replies against stale nodes.json keys.

Both take/produce `uint32` nodeNum + hex string, so the keycache signature slots in with no type churn. `packet.GetFrom()` is the uint32 nodeNum (`crypto.go:55,75`). The existing in-process `pubKeyCache sync.Map` (`crypto.go:27`) is the fleet-wide-shared precedent the keycache generalizes.

### nackHandler (miss → NACK, fallback=none)
Already wired: `internal/mqtt/mqtt.go:165` calls `decryptPKI`; on error (:169-171) fires `c.nackHandler(to, from, packet.GetId())`. Registered at `internal/app/fleet/cmd.go:100-101` (`SetNackHandler`, triggers a nodeinfo request). So `fallback=none` needs **no new NACK plumbing** — a keycache miss returning an error naturally flows into the existing nack path. Log every fallback/miss for enrollment-coverage measurement (MRAD-07).

### Testing conventions to port
`internal/credcache/{auth_test.go, cache_test.go, store_test.go}` (present). `store_test.go` uses `NewDynamoDBStoreWithClient(client, table)` with a fake `DynamoDBAPI` — port to a fake `GetItem` client for keycache. Port `auth_test.go` cases: hit / miss / negative-cache / singleflight-collapse / circuit-breaker-open (this is Success Criterion #2's proof). Add a Go test asserting the composed key string equals `$run#nodeid_!…` / `$meshradio_1` — the Go-side twin of `qr-key-parity.test.ts`.

---

## 7. Landmines / risks

| # | Risk | Detail / Mitigation |
|---|------|---------------------|
| L1 | **pk/sk parity (biggest)** | meshtk Go must compose the byte-identical ElectroDB key. No GetItem precedent in meshtk (credcache Scans). Format confirmed: `pk="$run#nodeid_<nodeId>"`, `sk="$meshradio_1"`. **Lock both sides with parity tests** (TS: clone `qr-key-parity.test.ts`; Go: assert the composed string). Any change to entity/version/service silently 404s every decrypt. |
| L2 | **nodeId zero-padding** | flash pads hex to 8 (`meshtastic.ts:657`); manual-add does NOT (`meshtastic-radios/route.ts:47`). meshtk composes `!%08x` from nodeNum. **Canonicalize nodeId to pad-8 lowercase at the MeshRadio write boundary AND in backfill**, else a leading-zero nodeNum's pk mismatches → miss. Store `nodeNum` explicitly (spec §6) so meshtk never has to reverse `!hex`→int. |
| L3 | **base64 vs hex** (memory: "base64-not-hex app keys") | Device key is base64 through run.flash and the embedded list; meshtk/`ParseHexKey` needs `0x`hex. Convert once at the internal-route MeshRadio upsert; validate decoded length == 32. `derivePublicKey` returns base64 — the manual path also needs conversion when mirrored. |
| L4 | **Two pubkey call sites** | Both `crypto.go:55` (decrypt) and `fleet/cmd.go:223` (reply-encrypt) call `FetchPublicKeyFromDefcon`. Migrate BOTH. |
| L5 | **TTL vs staleness** | Plain 60–120s expiry (not write-invalidation). A Sync-keys re-key propagates within one TTL — acceptable per OVERRIDING constraint. Do NOT add write-invalidation (extra reads/coordination) unless a faster refresh is proven necessary. |
| L6 | **GSI slot** | `electro` table_type already provisions gsi1/gsi2/gsi3 (main.tf:24-53). `byUser` overlays a generic GSI (ElectroDB scopes by entity) → **no terraform change**. Don't add a physical GSI. |
| L7 | **Two-repo / two-PR split** | Monorepo (run.human + run.flash + docs) = ONE PR; meshtk (`~/working/meshtk` on `main`, NOT `apps/run.mqtt/meshtk` — memory `feedback_meshtk_upstream.md`) = its own PR, built into the run.mqtt image. Coordinate: MeshRadio must be written+backfilled before meshtk flips `fallback=none`. |
| L8 | **Immutable-tag release race** | Recurring memory landmine (multiple project files): verify the deployed ECR tag == YOUR commit after release. meshtk ships inside run.mqtt image. |
| L9 | **ESM adapter blocks bare scripts** | `client.ts` imports ESM-only `@auth/dynamodb-adapter`; bare `tsx` runs fail (migrate-ctf-answerhash.mts:12-25). Backfill uses raw `@aws-sdk` client OR an adapter-free MeshRadio entity module. |
| L10 | **Dual-write invariant drift** | If dual-write chosen, all 4 key-affecting write sites (#6,#8,#9,#10) must mirror to MeshRadio, incl. DELETE removing the MeshRadio row. A missed site = stale/orphan MeshRadio → wrong-key decrypt. Centralize in one `upsertMeshRadio(userId, radio)` / `deleteMeshRadio(nodeId)` helper called from every site. |
| L11 | **credcache default TTL 900s** | Do not inherit 900s for keycache; spec mandates 60–120s. Separate config key. |
| L12 | **nodeId lowercasing in pk** | ElectroDB lowercases composite values. nodeId hex is lowercase already, but ensure the write path never stores uppercase hex (internal route `:80` lowercases; manual `validateAndFormatNodeId:42,48` lowercases). Backfill must lowercase too. |

---

## 8. Open questions resolved

1. **§11 / MRAD-04 — retire embedded list vs dual-write:** RESOLVED via enumeration → **recommend DUAL-WRITE** (§1). ~9 read sites incl. the entire whoami radio-management UI and the `/api/user` spread; `MeshRadio` doesn't model verification/resend/quota flow state. Dual-write = zero UI regression, matches repo denormalization pattern, satisfies OVERRIDING low-risk posture. Hard-switch is viable for precon but strictly more work + regression surface. **Needs human sign-off** (spec author leaned hard-switch; enumeration argues dual-write). — CONFIRM BEFORE PLANNING.

2. **MRAD-08 terraform GSI:** RESOLVED → **no terraform change**; `electro` table_type pre-provisions gsi1/gsi2/gsi3; `byUser` overlays a generic GSI. Document, don't build.

3. **Table/region parity (meshtk ↔ run.human):** RESOLVED → both default `run-human-electro` / `us-east-1` (config.go:52-56 == client.ts:52). ✔

4. **NACK plumbing for fallback=none:** RESOLVED → reuse existing `nackHandler` (mqtt.go:165-171, registered fleet/cmd.go:100-101); a keycache-miss error flows into it. No new plumbing.

5. **Which GSI slot for `byUser`:** OPEN (minor) — gsi1 (shared w/ RunUser.byHash + Accomplishment.byType, safe via entity scoping) vs gsi3 (unused at table level, maximal isolation). Recommend **gsi1** for consistency with Accomplishment; gsi3 acceptable if reviewers prefer isolation. Planner's call; not blocking.

---

## Package Legitimacy Audit

**Not applicable — no new packages.** run.human uses existing `electrodb ^3.5.0` + `@aws-sdk/*` (already present). meshtk keycache reuses already-vendored `golang.org/x/sync/singleflight`, `github.com/maypok86/otter/v2`, `github.com/aws/aws-sdk-go-v2/*` (all imported by `internal/credcache/`). No install step.

## Security Domain

`security_enforcement` not set to false → included. This phase IS a security control (closes pubkey poisoning + staleness).

### Applicable ASVS categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | run.flash session + `x-internal-secret` server-to-server (register-radio/route.ts:18-26; internal route :23-25) already gate writes; MQTT cannot write DDB |
| V4 Access Control | yes | Only authenticated run.flash sessions write MeshRadio; `assertNotLockedLive` at write boundary |
| V5 Input Validation | yes | Validate pubkey decodes to exactly 32 bytes before hex-store; nodeId format (`validateAndFormatNodeId`) |
| V6 Cryptography | yes | X25519 + AES-CCM path is fixed firmware-parity code (`crypto.go`) — **never hand-roll**; this phase only changes the *key source*, not the crypto |
| V7 Error/Logging | yes | Log every fallback/miss for enrollment-coverage; never log privateKey/publicKey values (mesh-map already redacts, route.ts:14) |

### Known threat patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Pubkey poisoning (any MQTT publisher asserts any node's key via NODEINFO) | Spoofing/Tampering | DDB-authoritative key + `fallback=none` (miss→NACK). This is the incident being fixed. |
| Stale key after re-flash (wrong shared secret → MAC fail) | Availability | Sync keys re-registers; keycache TTL bounds propagation |
| Cred-shared node spoofing (traffic as another node) | Spoofing | **OUT OF SCOPE** — Layer 2 (spec §9); `byUser` GSI designed now to enable it later |

**Security regression test (Success Criterion #3):** a NODEINFO injected on the broker with a bogus pubkey (the exact hotfix exploit) must NOT change decrypt behavior when `fallback=none`.

## Validation Architecture

**SKIPPED** — `.planning/config.json` sets `workflow.nyquist_validation: false`. (Standard unit tests still expected: keycache table-tests ported from credcache; MeshRadio key-parity test; register-radio base64→hex test; backfill idempotency test — per spec §7.)

## Sources

### Primary (HIGH — read from source this session)
- `docs/authoritative-pubkey-ddb-design.md` (full spec, §1-11) — approved design
- `.planning/ROADMAP.md:675-698` — Phase 66 requirements MRAD-01..08 + success criteria
- run.human: `entities/run-user.ts`, `entities/accomplishment.ts`, `entities/client.ts`, `entities/__tests__/qr-key-parity.test.ts`, `lib/qr-code-normalize.ts`, `api/internal/meshtastic-radios/route.ts`, `api/meshtastic-radios/route.ts`, `api/meshtastic-radios/resend/route.ts`, `api/internal/mesh-map/route.ts`, `api/user/route.ts`, `whoami/page.tsx`, `components/profile/MeshtasticRadios.tsx`, `scripts/migrate-ctf-answerhash.mts`, `scripts/reset-ctf-user.mts`
- run.flash: `lib/meshtastic.ts`, `hooks/use-configure.ts`, `app/api/register-radio/route.ts`, `components/done/done-step.tsx` (via grep)
- meshtk (`~/working/meshtk`, branch `main`): `internal/credcache/{auth,store,types,cache}.go`, `internal/mqtt/crypto.go`, `internal/mqtt/mqtt.go`, `internal/app/server/cmd.go`, `internal/app/fleet/cmd.go`, `pkg/config/config.go`
- infra: `infra/terraform/modules/dynamodb/v1.0.0/main.tf`

### Secondary (MEDIUM)
- Auto-memory: `feedback_meshtk_upstream.md` (code lands in `~/working/meshtk`), `project_ghost_chatbot_reply_debug.md` (base64-not-hex, dc.run PSK, the incident), `reference_mesh_mqtt_cred_lockout.md`, immutable-tag release-race landmines

## Metadata
**Confidence breakdown:**
- Reader/writer enumeration: HIGH — exhaustive grep across all apps + implicit `/api/user` spread found by reading the route
- ElectroDB pattern + key format: HIGH — confirmed against live parity tests + terraform module source
- pk/sk parity guidance: HIGH — format verified; empirical re-verification recommended in-plan (write one MeshRadio, dump raw pk/sk) before hardcoding in Go
- meshtk touchpoints: HIGH — all call sites + config + nack path read at file:line
- MRAD-04 recommendation: MEDIUM-HIGH — enumeration is complete; the migrate-vs-dual-write *choice* is a judgment call flagged for sign-off

**Research date:** 2026-07-18
**Valid until:** 2026-08-17 (stable; precon test data, no fast-moving deps)

## RESEARCH COMPLETE

- **Piece 1 (run.human):** Clone `accomplishment.ts` for `MeshRadio` (pk `nodeId`, `byUser` on existing gsi1 — no terraform change). Enumeration found ALL readers/writers inside run.human (~9 read sites incl. whoami UI + `/api/user` spread) → **recommend DUAL-WRITE** (keep embedded list; needs sign-off vs spec's hard-switch lean). base64→`0x`hex converts at the internal register route.
- **Piece 2 (run.flash):** "Sync keys" = new `syncKeys()` in `use-configure.ts` cloning `retryRegistration` + `requestSecurityKeys` read-back; button in `done-step.tsx`. No re-provision.
- **Piece 3 (meshtk `main`):** New `internal/keycache/` mirroring `credcache` but `GetItem` not `Scan`; swap BOTH `crypto.go:55` (decrypt) and `fleet/cmd.go:223` (reply) off `FetchPublicKeyFromDefcon`; fallback flag reuses the existing `nackHandler`; config parallels `CredCacheConfig`.
- **Biggest landmine:** pk/sk parity (`$run#nodeid_<id>` / `$meshradio_1`) — no GetItem precedent in meshtk; lock with parity tests both sides. Second: nodeId pad-8 canonicalization. Third: base64-vs-hex.
- **Resolved:** MRAD-08 needs no terraform (gsi1/2/3 pre-provisioned); table/region match; NACK path already exists. **Two PRs** (monorepo + meshtk); write+backfill MeshRadio before flipping `fallback=none`.
