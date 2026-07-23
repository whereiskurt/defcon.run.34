# Phase 67 — Ghost Admin Roster + Derived OTP Seeds

**Date:** 2026-07-23 · **Status:** approved (Kurt, in-session) · **Branch:** `gsd/phase-67-ghost-admin-roster`

## Goal

A read-only `/admin/ghosts` roster on run.human showing every meshtk ghost (identity,
persona, node config, CTF linkage) — and, for OTP-bearing ghosts, the **final derived
TOTP seed** the deployed bot actually validates. Pair it with an upstream meshtk change
that derives the real TOTP secret from a server-side secret, so the value committed in
`meshtk.dc34.yaml` becomes a decoy — same model as the PKI keypair munging
(`DeriveNodeKey`, HKDF from `MESHTK_GHOST_KEY_SECRET`).

## Decisions (asked + answered)

- **Roster joins:** gpx `ghost-identities.ts` dossiers (copied — static data) **and**
  Ctf DDB entries. No new Strapi content type.
- **Secret anchor:** reuse `MESHTK_GHOST_KEY_SECRET` with a distinct HKDF info label.
  SSM param `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/ghost-key-secret` (already
  provisioned for the fleet; run.human gets the same `valueFrom`).
- **Scope:** ghosts only (10 entries; 8 with `OtpUrl`). Rabbits later.
- **YAML source:** committed snapshot in run.human (`copy-snapshot.json` pattern) +
  sync script + vitest parity test against the canonical file. No Docker/build.sh
  changes (standalone output would otherwise need file-tracing config).

## Derivation spec (MUST match bit-for-bit in Go and Node)

```
info    = "meshtk-otp-seed:" + fleet.Id + ":" + <secret param of committed OtpUrl>
key     = HKDF-SHA256(ikm = MESHTK_GHOST_KEY_SECRET, salt = empty, info, L = 20 bytes)
secret  = base32(key)   # RFC 4648 alphabet, UPPERCASE, NO padding → 32 chars
otpauth = committed OtpUrl with only the `secret=` query param replaced
```

All other otpauth params (SHA1 / 6 digits / 120 s period / issuer / label) pass through
unchanged. Committed value is an HKDF input: rotating the YAML secret rotates the real
seed without touching the server secret; the committed value never validates anything
once derivation is live.

**Shared test vectors** (in Go test AND vitest so the implementations can't drift):

| server secret | fleet Id | committed | derived (base32) |
|---|---|---|---|
| `test-server-secret` | `ghost.goldstein` | `GZRGQNKGKN4DINQ` | `XHNN23O25QAZITZ4CZTCXU4NIR6LRRCK` |
| `test-server-secret` | `ghost.mudge` | `NA2DG` | `7KS3JJBI5CD6POHUUCC6XWHE65TXHGGX` |
| `another-secret` | `ghost.condor` | `EZRWO` | `74M2OE6WWHRXQYZUBYC6ZJ6TX5NKGRDR` |

(Node `hkdfSync` with `Buffer.alloc(0)` salt ≡ Go `hkdf.Key` nil salt — HMAC zero-pads
both to the block size; vectors above prove it.)

## Part 1 — meshtk upstream (`~/working/meshtk`, PR to whereiskurt/meshtk)

- `pkg/otp/derive.go`: `DeriveTotpSecret(serverSecret, fleetID, committedSecret)` and
  `DeriveOtpUrl(serverSecret, fleetID, otpURL)` (parses URL, extracts committed secret,
  swaps in derived).
- `internal/app/fleet/cmd.go`: when `Config.GhostKeySecret != ""` and the entry has an
  `OtpUrl`, rewrite it via `DeriveOtpUrl` **before** `otp.NewOTPHandler`. A derivation
  error fails fleet startup (loud > silent security downgrade). Env unset → committed
  plaintext, exactly like the keypair fallback (local dev).
- `pkg/otp/derive_test.go`: shared vectors + URL-rewrite round-trip.

## Part 2 — run.human

- **Snapshot:** `webapp/src/data/meshtk-fleet.dc34.yaml` (committed copy of
  `apps/run.mqtt/meshtk/meshtk.dc34.yaml`) + `webapp/scripts/sync-meshtk-fleet.mjs`
  (cp + drift report) + vitest parity test (byte-equality when the canonical file is
  reachable; skips cleanly otherwise).
- **`src/lib/mesh-ghosts.ts`** (server-only): parse snapshot with the `yaml` package
  (new dep). Extract `Id: ghost.*` entries: slug, description, behaviours, name
  templates, movement type, chatbot response matrix, committed OtpUrl, persona prompt,
  and the covert flag code via `/secret code is '([^']+)'/`.
- **`src/lib/mesh-otp-derive.ts`**: Node twin of the derivation (hkdfSync + local
  base32 encode) + vitest vectors.
- **`src/lib/ghost-dossiers.ts`**: dossier data copied from gpx `ghost-identities.ts`
  (biographical only — the NEVER-hint-at-flags rule carries over to card copy;
  the admin page may show flag codes, but dossier blurbs stay clean).
- **Page `(protected)/admin/ghosts/`**: server component, `gateAdminPage`-style gate
  (requireGroups(ADMIN_GROUPS) + revalidateGroups, 404 on denial — mirror
  /admin/leaderboard). One card per ghost: identity + dossier, behaviour/config chips,
  chatbot matrix, CTF linkage, OTP panel.
- **CTF linkage:** `listCtf()` join. A Ctf row belongs to ghost G when its challenge
  slug contains G's persona slug OR its `otp.secret` equals G's committed **or**
  derived secret. Badge per OTP ghost: **IN SYNC** (row secret == derived), **STALE**
  (== committed — bot will reject those codes once the fleet redeploys), or **no CTF
  row**. The DC33 chains in `ctf-seed-rows.ts` share the ghost secrets, so this badge
  is the operator's cue to update `effect.otpauth` + `otp.secret` via the existing
  /admin/qr CTF form after rollout (page itself stays read-only).
- **OTP reveal:** seeds NEVER in the page payload. `POST /api/admin/qr` gains action
  `ghost_otp_reveal { ghostId }` (mirrors `ctf_otp_reveal`; same gate + 404 contract)
  → `{ otpauth, secret, committed, ctfSync }`. Card reveal renders the existing
  `CtfOtpEnroll` (QR + live prev/CURRENT/next codes + copy link) — that's the "talk to
  the deployed bots" workflow: scan into an authenticator, message the ghost.
  If `MESHTK_GHOST_KEY_SECRET` is unset the reveal returns
  `configured:false` and the panel says so; roster still renders.
- **Admin link:** add Ghosts to the /admin console nav row.
- **Printable QR sheet (added post-approval, Kurt request):** a "Print QR sheet"
  button on the roster reveals every OTP ghost's derived otpauth (via the same
  gated action) and composes a PDF client-side — one QR + name label per cell on
  a large-cell 3×3 (default) or 3×5 grid, chunking to extra pages on overflow.
  Reuses the qr-sheet layout math + injected-renderer seam
  (`qr-sheet/ghost-sheet.ts`); QRs render plain black-on-white for scanner
  compatibility. Sheet header marks it SENSITIVE (every QR is a live seed).
- **Infra:** `services/run.human/service.hcl` secrets += `MESHTK_GHOST_KEY_SECRET`
  (same `valueFrom` as run.mqtt's ghosts container).

## Rollout

1. Merge meshtk PR → rebuild/redeploy fleet (env already provisioned) → bots switch to
   derived secrets.
2. Merge run.human PR → release. Page shows derived seeds (valid the moment the fleet
   restarts) + STALE badges on the DC33 CTF chains.
3. Operator updates the 5 chained Ctf rows with derived values (existing CTF form).
4. Old plaintext secrets remain burned in git history; everything new never touches
   the repo.

## Testing

- Go: `go test ./pkg/otp/...` (vectors, URL rewrite) + full `go test ./...`.
- run.human vitest (Node ≥ 22.12): derive vectors, YAML parse of the real snapshot
  (10 ghosts, 8 OTP, flag codes extracted), snapshot parity, reveal-action gate.
- No live-bot testing in this phase (fleet redeploy is Kurt's call).
