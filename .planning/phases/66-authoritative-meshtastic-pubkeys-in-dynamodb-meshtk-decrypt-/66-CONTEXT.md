# Phase 66: Authoritative Meshtastic Pubkeys in DynamoDB — Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Source:** Approved spec `docs/authoritative-pubkey-ddb-design.md` + user sign-off on the §11 open question

<domain>
## Phase Boundary

Point meshtk's decrypt path at the authoritative X25519 pubkey run.flash captures (DDB), not the
unauthenticated broadcast `nodes.json` feed. Three pieces: (1) run.human `MeshRadio` entity + backfill +
register-radio write; (2) run.flash "Sync keys"; (3) meshtk `internal/keycache` + `decryptPKI` swap +
fallback flag. See ROADMAP Phase 66 (MRAD-01..08) and RESEARCH.md for file:line anchors.

Out of scope: Layer 2 cred↔node ACL binding (spec §9); nodes.json-from-DDB (PR #806).
</domain>

<decisions>
## Implementation Decisions

### LOCKED — spec §10 resolved decisions
- Pubkey encoding: `0x` hex in `MeshRadio`, converted from device base64 once at the `register-radio` write boundary.
- Data model: first-class `MeshRadio` ElectroDB entity keyed by `nodeId`, GSI `byUser` (pk `userId`) — not a denormalized lookup item.
- keycache TTL: 1–2 min, **plain expiry** (not write-invalidation).
- `nodes.json` generation: out of scope (PR #806).

### LOCKED — OVERRIDING constraint (subordinate everything to this)
Keep DDB load minimal. meshtk in-memory keycache is the primary path; DDB read ≤ ~once per node per TTL,
shared **process-wide** across the ~34-client ghost fleet — never per-packet, never per-client. singleflight
+ negative caching + circuit breaker. Direct `GetItem` by nodeId/nodeNum, **never `Scan`**. Up-to-TTL key
staleness is acceptable.

### LOCKED — §11 open question resolved by USER sign-off (2026-07-18): HARD-SWITCH
**`MeshRadio` is the SINGLE SOURCE OF TRUTH. Retire the embedded `RunUser.meshtasticRadios[]` list.**
- `MeshRadio` must model the FULL radio state, not just decrypt keys: `nodeId`(pk), `nodeNum`, `userId`,
  `publicKey`(0x hex), `privateKey`, `verified`, `verificationCode`, `verifiedAt`, `verificationAttempts`,
  `resendAttempts`, `impersonate`, `showOnMap`, `source`(`flash`|`sync`|`manual`), `createdAt`, `updatedAt`.
- Migrate EVERY reader/writer enumerated in RESEARCH.md §1 onto `MeshRadio`:
  - `api/meshtastic-radios/route.ts` GET (list via `byUser`), POST (add), PATCH (verify/keys/impersonate/showOnMap), DELETE
  - `api/meshtastic-radios/resend/route.ts`
  - `api/internal/meshtastic-radios/route.ts` (register from run.flash — the base64→hex write boundary)
  - `api/internal/mesh-map/route.ts` (map feed: verified+showOnMap radios → `{nodeNum,displayName,...}`)
  - `api/user/route.ts` spread → `whoami/page.tsx` prop → `components/profile/MeshtasticRadios.tsx`
  - `entities/run-user.ts`: remove the embedded `meshtasticRadios` attr, `updateMeshtasticRadios()`, `MeshtasticRadio` type, `sanitizeRadio()`; migrate their tests
- Per-user radio quota (if enforced today) now derives from a `byUser` count, not `meshtasticRadios.length`.
- Backfill (MRAD-03) creates `MeshRadio` rows from every existing `meshtasticRadios[]` entry BEFORE readers flip.
  Precon test data → one-off + hard switch is acceptable (spec §8, §8a "a mistake is re-runnable").

### LOCKED — pk/sk parity (RESEARCH.md L1, biggest landmine)
- ElectroDB v3.5 key format: `pk="$run#nodeid_<nodeId>"`, `sk="$meshradio_1"`; byUser `gsi1pk="$run#userid_<userId>"`.
- Empirically re-verify BEFORE hardcoding Go: write one `MeshRadio`, dump raw pk/sk.
- Lock BOTH sides with parity tests (TS: clone `qr-key-parity.test.ts`; Go: assert composed key string).

### LOCKED — nodeId canonicalization (RESEARCH.md L2)
Canonicalize `nodeId` to `"!" + nodeNum.toString(16).padStart(8,"0")` (lowercase) at EVERY `MeshRadio` write
(register, user-add, backfill). Store `nodeNum` (uint32) explicitly so meshtk composes `fmt.Sprintf("!%08x", nodeNum)`.

### LOCKED — GSI / terraform (MRAD-08): NO terraform change
`electro` table_type pre-provisions gsi1/gsi2/gsi3 (all projection ALL). `MeshRadio.byUser` overlays a
generic GSI (ElectroDB scopes by entity). Recommend `gsi1pk-gsi1sk-index` (consistent with Accomplishment);
planner may pick gsi3 for isolation. Document, don't build infra.

### LOCKED — meshtk (separate repo)
Code lands in `~/working/meshtk` on `main` (NOT `apps/run.mqtt/meshtk`). New `internal/keycache/` mirrors
`internal/credcache/` (`CacheAuthenticator`) but uses `GetItem` not `Scan`. Swap BOTH pubkey call sites off
`FetchPublicKeyFromDefcon`: `crypto.go:55` (decrypt) AND `fleet/cmd.go:223` (reply-encrypt). Fallback flag
`fallback=nodes.json`(bring-up) | `fallback=none`(miss→existing `nackHandler`, closes poisoning); log every
fallback. keycache config parallels `CredCacheConfig` (TTL default 60–120s, NOT credcache's 900s).

### Claude's Discretion
- Exact helper factoring in run.human (a single `MeshRadio` store module used by all routes).
- GSI slot choice (gsi1 vs gsi3).
- Go keycache internal struct names (mirror credcache).
- Test granularity beyond spec §7's required cases.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec & requirements
- `docs/authoritative-pubkey-ddb-design.md` — approved design (§10 resolved, §11 resolved to hard-switch)
- `.planning/ROADMAP.md` `### Phase 66:` — MRAD-01..08 + success criteria
- `.planning/phases/66-authoritative-meshtastic-pubkeys-in-dynamodb-meshtk-decrypt-/66-RESEARCH.md` — file:line map for all 8 requirements + 12 landmines

### run.human (monorepo, `apps/run.human/webapp/`)
- `src/entities/accomplishment.ts` — clone template for `MeshRadio` (GSI-bearing entity)
- `src/entities/__tests__/qr-key-parity.test.ts` — key-parity test to clone
- `src/entities/run-user.ts` — embedded list to RETIRE (`:87-107`, `updateMeshtasticRadios`, `MeshtasticRadio`, `sanitizeRadio`)
- `src/app/api/internal/meshtastic-radios/route.ts` — register write boundary (base64→hex)
- `src/app/api/meshtastic-radios/route.ts` + `resend/route.ts` — user CRUD to migrate
- `src/app/api/internal/mesh-map/route.ts`, `src/app/api/user/route.ts`, `src/app/whoami/page.tsx`, `src/components/profile/MeshtasticRadios.tsx` — readers to migrate
- `scripts/migrate-ctf-answerhash.mts` — backfill script template (raw aws-sdk; ESM-adapter caveat)

### run.flash (monorepo, `apps/run.flash/webapp/`)
- `src/hooks/use-configure.ts` (`retryRegistration`, `requestSecurityKeys` read-back), `src/components/done/done-step.tsx` (button), `src/lib/meshtastic.ts`

### meshtk (`~/working/meshtk`, branch `main`)
- `internal/credcache/{auth,store,cache,types}.go` (+ tests) — mirror for `internal/keycache/`
- `internal/mqtt/crypto.go` (`decryptPKI`, `FetchPublicKeyFromDefcon`, `ParseHexKey`), `internal/mqtt/mqtt.go` (nack), `internal/app/fleet/cmd.go` (reply call site + `SetNackHandler`), `internal/app/server/cmd.go`, `pkg/config/config.go`

### infra
- `infra/terraform/modules/dynamodb/v1.0.0/main.tf` — confirms gsi1/2/3 pre-provisioned (no change)
</canonical_refs>

<specifics>
## Specific Ideas
- Success Criterion #1 (live-incident verification): with KPH's real key in `MeshRadio`, a ghost decrypts a KPH DM with `nodes.json` ignored (`fallback=none`).
- Deliverable: monorepo = ONE PR on `feat/authoritative-pubkey-ddb`; meshtk = its own branch/PR. Build to reviewable state then STOP — no deploy until user approval.
- Sequencing at deploy time: write+backfill `MeshRadio` BEFORE meshtk flips `fallback=none`.
</specifics>

<deferred>
## Deferred Ideas
- Layer 2 cred↔node ACL binding (spec §9) — `byUser` GSI designed now to enable it later.
- nodes.json generation from DDB (PR #806).
- Syncing `verified` flag on resend/verification-only PATCH is inherent under hard-switch (MeshRadio is the store).
</deferred>

---

*Phase: 66-authoritative-meshtastic-pubkeys-in-dynamodb-meshtk-decrypt-*
*Context gathered: 2026-07-18 — spec + user sign-off (hard-switch)*
