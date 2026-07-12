# Auth Identity & Sessions Admin Dashboard — Design

**Date:** 2026-07-12
**Service:** run.auth (`auth.defcon.run`)
**Status:** Approved — proceeding to implementation plan

## Problem

run.auth is the central identity provider (IdP). Users authenticate through OAuth
providers (GitHub, Discord, LinkedIn) and email OTP, then downstream apps
(run.human, bib, gpx, flash, cms) consume it as OIDC relying parties.

Because every OAuth provider is configured with
`allowDangerousEmailAccountLinking: true`, a user can sign in with GitHub, then
LinkedIn, then Discord on the same email address and all three **collapse onto a
single identity**. OAuth logins also bypass the Altcha challenge, so accounts can
be created quickly. There is currently **no admin surface at the auth layer** to
observe or act on this — the existing run.human `/admin` dashboard operates one
level *below* the IdP (on run.human's own user records) and cannot see the
provider-linking picture.

We need an admin console at the auth layer that answers:

- Which identities exist, when were they created, and through which providers?
- Which run.human user does each identity map to?
- How do we lock out or delete an abusive identity?

## Reality Check: There Are No Auth.js Session Rows

run.auth runs Auth.js with `session: { strategy: "jwt" }`
(`apps/run.auth/webapp/src/config/auth.ts`). The session lives entirely in the
signed `sess_auth` cookie — **there is no session record in the database to
list.** The word "session" in the original request maps onto three record types
that *do* exist:

| Record | Table | Store | What it tells us |
|---|---|---|---|
| **`AuthProfile`** | `run-auth-electro` | ElectroDB (`entities/auth-profile.ts`) | The identity/human. `userId` (= OIDC `sub`), `displayName` (`rabbit_XXXX`), `email`, `services` (groups incl. `admin`), `lastProvider`, `createdAt`, per-provider maps (`github`/`discord`/`strava`) each with `linkedAt`, `lockedOut`, `lockoutReason`, `lockedAt`, `sessionVersion`. |
| **OAuth `Account`** | `run-auth-authjs` | Auth.js DynamoDB adapter | One `ACCOUNT#{provider}#{providerAccountId}` row per linked provider. The literal "was it GitHub / Discord / LinkedIn" record + `providerAccountId → userId` map. |
| **OIDC `Session`** | `run-auth-electro` | `OIDCModel` (`entities/oidc-adapter.ts`) | oidc-provider's own live SSO session for silent SSO; `accountId` (= sub), `expiresAt` (15-day TTL). Ephemeral. |

**Design consequence:** the dashboard's primary object is the **`AuthProfile`
identity** (one row per human), because that is the level at which
multi-provider collapse is visible and at which lockout/delete act. Live OIDC SSO
sessions are shown as secondary detail inside the per-identity drawer.

## The run.human Tie-Back (Live Cross-Service Join)

The OIDC `sub` emitted by run.auth **equals** `AuthProfile.userId`. On the
run.human side, run.human already exposes a secret-gated internal endpoint
`apps/run.human/webapp/src/app/api/internal/user/[oidcSub]` keyed by that same
sub (used today by the rabbit-name sync). So the join needs **no new IAM
cross-table access and no namespace-mismatch handling** — the sub is the key on
both sides.

- **Mechanism:** run.auth calls run.human's internal endpoint with the shared
  `AUTH_INTERNAL_SECRET` header and receives the run.human uuid + a small profile
  summary. This mirrors the existing bidirectional internal-secret pattern
  (run.human → run.auth `/api/session/validate/...` already exists).
- **run.human change:** add a `GET` handler to
  `/api/internal/user/[oidcSub]` returning `{ found, runUserId, displayName,
  lastActiveAt? }`. Secret-gated, 404 on unknown, never logs the sub.
- **Performance:** resolving the tie-back for every list row would be N calls per
  page load. Instead resolve it **lazily** — per-drawer on demand, plus one
  bulk-resolve call for the currently visible page — so the identities table
  stays fast. The list shows a "seen in run.human ✓/✗/…" indicator that fills in
  from the bulk resolve.

## Architecture

New surface, all inside `apps/run.auth/webapp/src`:

```
src/lib/admin-gate.ts                 # session-group gate (copied from run.human)
src/lib/identity-report.ts            # pure: buildIdentityRows, filter, sort, summary tiles, csvCell/toCsv
src/lib/runhuman-resolve.ts           # calls run.human internal endpoint (single + bulk), fail-soft
src/app/admin/layout.tsx              # own full-page shell (no existing app chrome to inherit)
src/app/admin/page.tsx                # server component: gate + initial masked rows
src/app/admin/AdminConsole.tsx        # "use client": table, filters, pager, drawer
src/app/admin/AdminActions.tsx        # "use client": lock / unlink / delete buttons + confirm modals
src/app/api/admin/identities/route.ts             # GET masked JSON (paginated) + ?format=csv
src/app/api/admin/identities/[userId]/route.ts    # GET drawer detail (accounts, oidc sessions, live run.human resolve)
src/app/api/admin/identities/[userId]/lock/route.ts     # POST lock/unlock
src/app/api/admin/identities/[userId]/unlink/route.ts   # POST delete one ACCOUNT# row
src/app/api/admin/identities/[userId]/route.ts (DELETE) # hard delete (run.auth only)
```

run.human side:
```
src/app/api/internal/user/[oidcSub]/route.ts   # add GET (secret-gated resolve)
```

### Access Gate

New `src/lib/admin-gate.ts`, mirroring
`apps/run.human/webapp/src/lib/admin-gate.ts`:

```ts
export const ADMIN_GROUPS = ["admin", "runadmin"] as const;
export function isAdmin(session): boolean            // session.user.services ∩ ADMIN_GROUPS
export function requireAdmin(session): { ok, reason, email }
```

run.auth's session callback already populates `session.user.services` from
`AuthProfile` on every JWT refresh, so the claim is available. Because run.auth
**is** the auth server, live re-validation reads `AuthProfile` **in-process**
(via `getAuthProfile(userId)`) rather than over HTTP — grant on
`admin`||`runadmin` AND `!lockedOut`, fail-closed. Every denial maps to a bare
`404` (non-disclosure), matching run.human. Framework-neutral so page and route
handlers share it.

### Page & Table (mirrors run.human `/admin`)

- `runtime = "nodejs"`, `dynamic = "force-dynamic"` on page and all routes.
- HeroUI + Tailwind semantic tokens (`bg-content1`, `border-divider`,
  `text-primary`, `text-default-400`, `text-warning`); `font-museo` header with a
  teal accent dot; summary tiles `bg-content1 border border-divider rounded-xl`.
- Header: `defcon.run 34 · Auth Identity Admin`, "signed in as {email}", live pip
  badge.
- **Main table = one row per `AuthProfile`:**
  - rabbit `displayName`
  - masked + CSS-blurred email (`blur-[3px] hover:blur-none`); full email never
    shipped in bulk
  - provider chips `GH` `DC` `IN` `ST` — filled when linked, `linkedAt` on hover
  - `lastProvider`
  - `createdAt`
  - services / groups
  - `LOCKED` badge when `lockedOut`
  - **run.human** column: rabbit + seen ✓/✗ (filled from bulk resolve)
- Client-side sort / filter / paginate over server-supplied masked rows
  (`useMemo`); sortable headers; rows-per-page selector.
- **Filter pills:** `multi-provider`, `locked`, `created <24h`, `admin`,
  `not-in-run.human`.
- **Masked email search:** debounced (~220ms) `fetch` to
  `/api/admin/identities?q=...` that matches full emails **server-side** and
  returns only matching `userId`s — bulk emails never reach the client.
- **CSV export:** plain `<a href>` to `/api/admin/identities?format=csv&...`,
  `Content-Disposition: attachment; filename="auth-identities-YYYY-MM-DD.csv"`,
  `Cache-Control: no-store`.

### Drawer (per identity)

Opened by clicking a row; fetches `/api/admin/identities/[userId]`:

- full unmasked email (revealed on demand, one identity at a time)
- every OAuth `Account` row: provider, `providerAccountId`, `linkedAt`
- live OIDC SSO sessions with `expiresAt`
- `sessionVersion`, `lockedOut` / `lockoutReason` / `lockedAt`
- resolved run.human uuid + profile summary (live call)
- action buttons (below)

### Admin Actions (escalating blast radius)

All `"use client"` with `busy`/`failed` state, `router.refresh()` on success, a
quiet inline error on failure (no refresh, so admin can retry). Destructive
buttons styled red (`color:#ff8a8a`, transparent bg, `1px solid` border), primary
styled mint.

1. **Lock out / unlock** — `POST .../lock`. Reuses existing lockout mechanics:
   sets `AuthProfile.lockedOut` + increments `sessionVersion` (forces downstream
   logout). Instant, reversible. `window.confirm` guard.
2. **Unlink a provider** — `POST .../unlink { provider, providerAccountId }`.
   Deletes one `ACCOUNT#{provider}#{providerAccountId}` row and clears that
   provider's map on `AuthProfile`. Revokes a single link (e.g. just GitHub).
   `window.confirm` guard.
3. **Hard delete (run.auth only)** — `DELETE /api/admin/identities/[userId]`.
   Removes `AuthProfile` + all `ACCOUNT#` rows + OIDC grants/sessions for that
   accountId. Guarded by a **typed-confirmation modal** (type the rabbit
   displayName to enable). Does **not** touch run.human/bib — see Out of Scope.

### API Route Pattern

Mirrors run.human/bib admin routes:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const gate = requireAdmin(await auth());
  if (!gate.ok) return new Response(null, { status: 404 });   // non-disclosure
  const body = bodySchema.parse(await req.json());            // zod → 400 on bad input
  await /* data-layer mutation via @/entities/auth-profile + adapter client */;
  return Response.json({ ok: true });
}
```

Routes never log request bodies (only errors). The single `identities` route
serves masked paginated JSON and, on `?format=csv`, full data.

### Data Layer

- Reads/writes `AuthProfile` via existing `@/entities/auth-profile`
  (`getAuthProfile`, `AuthProfile.update(...).set(...).go()`,
  `AuthProfile.scan` / `query.byEmail`).
- Reads OAuth `Account` rows + OIDC `Session`/grant rows via the existing
  DynamoDB document client and `OIDCModel` entity.
- Pure helpers (`buildIdentityRows`, `filterByEmail`, `sortRows`,
  `summaryTiles`, `csvCell`, `toCsv`) live in `src/lib/identity-report.ts`,
  ported from run.human's `admin-report.ts`, and are unit-testable without Next.

### Error Handling

- Gate failure → `404` everywhere (never 403/leak).
- Bad request body → `400` (zod).
- run.human resolve failure → **fail-soft**: the tie-back shows "unknown"
  rather than breaking the identity list. The auth data is authoritative; the
  run.human column is best-effort.
- Destructive routes are idempotent where possible (deleting an already-gone row
  returns ok).

### Testing

- Unit: `identity-report.ts` pure helpers (row building from fixture
  AuthProfile/Account records, email filter, sort, CSV escaping incl.
  formula-injection guard on attacker-controlled displayName/email).
- Unit: `admin-gate.ts` (admits admin/runadmin, rejects others, no-session).
- Route-level: gate returns 404 for non-admin; zod rejects bad bodies.
- Manual/UAT: signed-in admin renders table, drawer resolves run.human,
  lock/unlink/delete act correctly (staging).

## Out of Scope (explicit follow-up phases)

- **Cascade "trickle-down" delete** across run.auth + run.human + bib. v1 hard
  delete is run.auth-only. Cascade requires new internal delete endpoints in each
  downstream service and a carefully designed multi-service confirmation UX — its
  own phase.
- **Forcing Altcha on OAuth logins.** Discussed and explicitly deferred by the
  user; not part of this dashboard.
- **IP / geo capture on login.** No IP is recorded today; adding it is separate.

## Key Files Referenced

- `apps/run.auth/webapp/src/config/auth.ts` — Auth.js providers, JWT session, `services` claim
- `apps/run.auth/webapp/src/entities/auth-profile.ts` — AuthProfile model (identity, groups, lockout)
- `apps/run.auth/webapp/src/entities/oidc-adapter.ts`, `client.ts` — OIDC model store + table names
- `apps/run.auth/webapp/src/app/api/admin/user/[userId]/lock/route.ts` — existing lockout mechanics to reuse
- `apps/run.human/webapp/src/lib/admin-gate.ts` — gate to mirror
- `apps/run.human/webapp/src/lib/admin-report.ts` — pure CSV/report helpers to port
- `apps/run.human/webapp/src/app/(protected)/admin/AdminConsole.tsx` — table/drawer reference
- `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts` — endpoint to extend with GET
- `apps/run.bib/webapp/src/components/AdminActions.tsx` — mutating-action + confirm pattern
```
