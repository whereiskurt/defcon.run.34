# run.human Admin CRUD for QR / CTF codes — Design

**Date:** 2026-07-12
**Status:** Approved (brainstorming) → ready for implementation plan
**Related:** `docs/superpowers/specs/2026-07-11-qr-service-design.md` (5-phase QR service),
`docs/superpowers/specs/2026-07-12-qr-resolver-spec-corrections.md`,
memory `project_qr_resolver_phase2_4`, `project_phase43_admin_dashboard`.

## Context

The `q.defcon.run` resolver is **deployed live but inert** — it reads `Qr`/`Ctf`
from the shared `run-human-electro` table (`service: "run"`) but no codes exist,
so every scan 404s gracefully. This project builds the run.human `/admin` surface
to create and manage those codes, so operators can mint printable short links and
CTF challenges ahead of DEF CON 34.

**Scope (chosen "full surface"):**
- `Qr` CRUD including conditional `rules` (time/param destinations) and `enrich`
  (UTM tags, param-append).
- `Ctf` challenge CRUD (challenge / answer / points / effect / limits).
- Read-only scan analytics from `Qrstat`.

**Out of scope (explicit):**
- QR **image** generation (data-only; images produced by a separate workflow).
- The Phase-5 CTF `/ctf/claim` judge and anti-cheat (separate phase). This CRUD
  only *prepares* CTF data for it.

## Load-bearing facts (verified against the live resolver)

1. **QR code casing.** The resolver uppercases the scanned first path segment
   (`apps/run.qr/lambda/resolver/lib/parse-path.mjs:77`, `first.toUpperCase()`)
   before `Qr.get({ code })` (`.../lib/index.mjs:74`). The CRUD MUST normalize
   the `code` attribute to **UPPERCASE** on write and read, or the resolver reads
   the wrong key. Verified key encoding: `Qr.get({code:"BUNNY"})` → pk
   `$run#code_bunny`, sk `$qr_1` (ElectroDB lowercases the composite in the key
   template; the stored `code` attribute is the value you pass).
2. **The resolver never reads `Ctf`.** The `ctf` case in
   `apps/run.qr/lambda/resolver/lib/resolve.mjs` forwards
   `/ctf/<challenge>/<value>` verbatim to `run.defcon.run/use1/ctf/claim` with NO
   `Ctf.get`. So CTF CRUD rows have **zero effect on live redirect behavior** —
   they are data prep for the future Phase-5 judge only.
3. **CTF challenge casing.** parse-path keeps the challenge segment *verbatim*
   (case-kept). To give the future judge a stable key, the CRUD **normalizes
   challenge names to lowercase** on write. The Phase-5 judge MUST lowercase the
   incoming challenge before `Ctf.get`. This is recorded here as the contract.
4. **Write credentials already exist.** run.human's `electroClient`
   (`src/entities/client.ts`, `RUN_ELECTRO_ID/SECRET`) already writes to
   `run-human-electro` (RunUser, etc.). `Qr`/`Ctf`/`Qrstat` are new entities in
   the same table — **no infra / IAM change required**.
5. **Propagation delay.** The resolver holds a ≤60s warm cache with negative
   caching, so a newly created/edited `Qr` becomes live within ~60s. Acceptable
   (eventual). Note in UI copy if convenient; no cache-bust mechanism is built.

## Architecture

A new admin sub-surface at **`/admin/qr`**, following the exact patterns already
in the repo:

- **Reads** in server components — mirrors how `/admin/page.tsx` calls
  `buildUserReport()`. `force-dynamic`, `runtime = "nodejs"`.
- **Writes** through one action-based API route handler,
  `POST /api/admin/qr`, mirroring `/api/admin/quota/route.ts`'s
  `{ action, ...payload }` body shape.
- **Gating** identical everywhere via `@/lib/admin-gate`: sync `requireAdmin`
  then async `revalidateAdmin(session.user.authUserId)`. **Every denial → HTTP
  404** (non-disclosure contract; pages `notFound()`, API returns
  `new Response(null, { status: 404 })`).

## Integration update (implemented on `main`)

Between spec approval and implementation, `main` landed a `/admin` UX rework:
the admin surface moved into a **`(protected)` route group**
(`src/app/(protected)/admin/`, rendering inside the real run.human chrome via
`(protected)/layout.tsx`) with a client `AdminConsole.tsx` styled in the site's
**HeroUI/Tailwind tokens** (`bg-content1`, `border-divider`, `text-primary`),
and the old standalone dark `src/app/admin/page.tsx` was deleted.

To integrate cleanly, the QR surface below shipped **under `(protected)/admin/qr/`**
(so it inherits the chrome + gate) and is **styled with the same Tailwind tokens**
rather than the standalone dark inline styles the sections below describe. Shared
class strings + `apiBase`/`QR_ORIGIN` live in `src/components/admin/qr-ui.ts`
(the old `theme.ts` is gone). The link-in is a `QR / CTF →` button in the
`AdminConsole` header (not the deleted admin page). File paths below read
`src/app/admin/qr/...`; the real paths are `src/app/(protected)/admin/qr/...`.
Everything else (entities, validation, API, routing/sentinels, tests) is as
specified.

## Components (single-purpose units)

### 1. `src/entities/qr.ts` — TS entity mirror
TS `Qr`, `Ctf`, `Qrstat` entities, **byte-identical contract** to
`apps/run.qr/lambda/resolver/lib/entities.mjs`: same `model.entity` / `version` /
`service: "run"`, same index `field:` names (`pk`/`sk`,
`gsi1pk-gsi1sk-index`), same composite keys. Bound to run.human's `electroClient`
+ `ELECTRO_TABLE` (from `./client`). Only-declare-what-we-use is fine for reads,
but for the mirror the **key config must match exactly** (guarded by a parity
test — see Testing). Docstring cross-links the `.mjs` and flags the
keep-in-lockstep contract, like `src/entities/bib.ts` does.

### 2. `src/lib/qr-admin.ts` — data + validation (server-only)
Pure/near-pure helpers plus the ElectroDB read/write calls:

- `normalizeCode(raw): string` → trims + UPPERCASE. Throws on invalid shape.
- `normalizeChallenge(raw): string` → trims + lowercase.
- `validateDestination(url): void` → parses `new URL(url)`; requires
  `protocol === "https:"`; throws a typed error otherwise. Applied to
  `destination` AND every `rules[].dest`.
- `CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`; reject codes normalizing to
  `CTF`, `_FLUSH` (reserved resolver namespaces — unreachable as codes) or `NEW`
  (reserved as the create-route sentinel). Challenges likewise reject `new`.
- Reads: `listQrCodes()` (scan `Qr`), `listCtf()` (scan `Ctf`),
  `getQrStats(code)` (query `Qrstat` by `code`, split buckets into
  total / day# / param# / ctf#).
- Writes: `upsertQr(input)`, `deleteQr(code)`, `upsertCtf(input)`,
  `deleteCtf(challenge)`. Upserts run validation/normalization first.

### 3. `src/app/api/admin/qr/route.ts` — write API
`POST` handler. Gate (requireAdmin + revalidateAdmin → 404 on denial). Parse
`{ action }` ∈ `qr_upsert | qr_delete | ctf_upsert | ctf_delete`; dispatch to
`qr-admin`; return `{ success, message }` (validation errors → 400). Structured
like `/api/admin/quota/route.ts` but using the 404-on-denial gate.

### 4. `src/app/admin/qr/page.tsx` — list view
Server component. Two tables (dark theme matching `/admin`):
- **QR codes:** code · type · destination · #rules · enabled · total scans ·
  updatedAt · edit link.
- **CTF challenges:** challenge · points · enabled · maxAttempts · updatedAt ·
  edit link.
Plus "New QR code" / "New CTF challenge" links. `force-dynamic`,
`runtime = "nodejs"`, gated.

### 5. `src/app/admin/qr/[code]/page.tsx` — QR detail / edit + analytics
Server component renders the `QrForm` (below) pre-filled, plus a **read-only scan
analytics** panel from `getQrStats(code)`: prominent total, then breakdown tables
for per-day (`day#*`, desc), per-param (`param#*`), per-ctf (`ctf#*`). CTF
create/edit lives on its own route `src/app/admin/qr/ctf/[challenge]/page.tsx`
(rendering `CtfForm`). Creates use **static** sibling routes
`src/app/admin/qr/new/page.tsx` and `src/app/admin/qr/ctf/new/page.tsx` (Next.js
resolves the static `new` segment before the dynamic `[code]`/`[challenge]`).
The validators reserve `NEW` (and `new`) so a real code/challenge can never
shadow a create route.

### 6. `src/components/admin/QrForm.tsx` — the one interactive unit (`"use client"`)
The only client component. Fields: code (locked on edit), destination, enabled,
type, owner, notes, a **dynamic rules editor** (add/remove rows; each row is
`kind: time {from,to,dest}` or `kind: param {match,dest}`), and an **enrich
editor** (preserveQuery, appendParam, utm.source/medium/campaign). Client-side it
validates https on dest fields for fast feedback, then `POST`s the assembled
payload to `/api/admin/qr`; the server re-validates authoritatively. A sibling
`CtfForm.tsx` (flat fields) handles CTF. Rendering of lists/detail stays server;
only these forms ship JS.

## Data flow

```
READ:   /admin/qr (server) ──▶ qr-admin.list*/getQrStats ──▶ electroClient ──▶ render
WRITE:  QrForm (client) ──POST /api/admin/qr──▶ gate ──▶ validate/normalize
                                              ──▶ electroClient write ──▶ {success}
                                              ──▶ revalidatePath('/admin/qr') + client redirect
LIVE:   resolver picks up Qr edits within ≤60s warm cache.
        Ctf rows do NOT affect the resolver (verbatim forward) — feed Phase-5 judge.
```

## Validation & error handling

- **Destination / rule dests:** absolute `https:` only. Reject `javascript:`,
  `data:`, `http:`, relative, unparseable. Enforced server-side in `qr-admin`;
  mirrored client-side for UX only.
- **Code:** `CODE_RE` + UPPERCASE + reserved-name (`CTF`/`_FLUSH`) rejection.
- **Challenge:** non-empty, lowercase-normalized.
- **Delete:** UI confirmation before the POST.
- **Gate:** any failure (no session / not admin / stale claims) → 404 with no
  body, never 401/403, never the page.
- **API errors:** validation → 400 `{success:false,message}`; unexpected → 500
  (logged), generic message.

## Testing

Vitest (Node ≥ 22.12 — the repo's known constraint) unit tests for `qr-admin`:

- `validateDestination`: accept `https://run.defcon.run/x`; reject `http:`,
  `javascript:`, `data:`, relative, empty, malformed.
- `normalizeCode`: uppercases; rejects bad shapes; rejects `ctf`/`_flush`/`new`
  (any case).
- `normalizeChallenge`: lowercases, trims.
- upsert/delete: assert the ElectroDB `.params()` `Key`/`Item` shape against a
  mocked `electroClient`.
- **Key-parity guard:** assert the TS `Qr.get({code:"BUNNY"})` `.params().Key`
  equals the resolver's asserted key (`pk:"$run#code_bunny"`, `sk:"$qr_1"`), and
  `Ctf.get({challenge:"sao"})` matches its `.mjs` counterpart. This is the
  regression net that keeps the mirror byte-identical to the resolver.

## Decisions log

1. **Full surface** (QR + rules/enrich + CTF + analytics) — chosen over an MVP
   slice.
2. **Data-only**, no QR image generation.
3. **Destination policy: absolute https only** (chosen over host-allowlist and
   warn-on-external). Trusts gated admins on host choice.
4. **CTF challenge names stored lowercase-normalized**; Phase-5 judge must
   lowercase to match (recorded as the forward contract).
5. **404-on-denial** gate everywhere (non-disclosure), consistent with the newer
   `/admin` surface rather than the older quota route's 401/403.
