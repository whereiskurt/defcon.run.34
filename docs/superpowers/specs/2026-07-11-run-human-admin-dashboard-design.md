# run.human Admin Dashboard — Design

**Date:** 2026-07-11
**App:** run.human (`run.defcon.run`)
**Route:** `/admin`
**Status:** Design — awaiting review

## Goal

Give admins (currently Kurt & Jesse) a read-only starting dashboard at
`run.defcon.run/admin` that surfaces run.human users and their activity — with a
focus on **finding people who signed up and are actively using the system**,
especially **who is using gpx to store files** or leaning hard on a particular
service. Email must be **searchable** but **not plastered across the screen**.

Non-goals for v1: user edits, impersonation, service grants, deletes, or any
write action. Reporting only.

## Security model (verified working as designed)

Admin authorization is **not** a hardcoded email list and **not** client-forgeable.

- "Admin" = the string `"admin"` inside a per-user `services: string[]` list.
- **Source of truth:** run.auth's `AuthProfile.services` in DynamoDB.
- The OIDC provider mints `services` into the ID token at login
  (`run.auth/webapp/src/config/oidc.ts` → `findAccount().claims()`).
- The claim then rides in run.human's **own server-signed JWT** session cookie
  (HS256/JWE, signed with `config.auth.jwtSecret`) — a client cannot mint or edit
  it without the server secret.
- The claim is **reconciled against DynamoDB every ~5 min** via
  `GET {privateAuthServer}/api/session/validate/user/{userId}` (behind
  `X-Internal-Secret`). Revoking admin propagates within ~5 minutes, no redeploy.

**Caveat addressed by this design:** the standard gate trusts the cached JWT for up
to ~5 min. Because `/admin` is sensitive, its gate will additionally force a
**synchronous fresh-claims revalidation on entry** so a just-revoked admin cannot
linger. Non-admins receive a **404** (do not advertise the route's existence).

Reference implementations to mirror:
- `apps/run.bib/webapp/src/lib/admin-gate.ts` (`isAdmin` / `requireAdmin`)
- `apps/run.human/webapp/src/app/api/admin/quota/route.ts` (existing `services.includes("admin")` gate)

## Architecture

Two units, each with one clear purpose:

### 1. Admin data API — `app/api/admin/users/`

Server-only. Admin-gated (`requireAdmin` + synchronous revalidation). Returns JSON;
renders nothing. Responsibilities:

- **List/scan** `RunUser` (`run-human-electro`) — the primary user list.
- **Join email** from run.human's *own* Auth.js adapter table (`run-human-authjs`,
  `USER#` records) keyed by the same `userId`. Emails are used server-side for
  search and returned **masked** by default; a full value is returned only when a
  row's explicit "reveal" is requested.
- **Join uploads** via `listUploadsByUser` / `UserUpload` counts (gpx/photo).
- **Join gpx usage** from the run.auth quota service (see unit 2).
- **Join bib/runnerCode** (optional column) via `getRunnerCode`.
- Support server-side **sort**, **pagination**, **email search**, and a **CSV
  export** mode (`format=csv`) that streams the full filtered/sorted result set.

### 2. Bulk gpx-usage read — new endpoint on run.auth

`GET {privateAuthServer}/api/internal/quota/by-type/{quotaId}` (internal-secret
gated, read-only, ~30 lines). Queries the **existing** `byQuotaRemaining` GSI
(`pk = quotaId`, `sk = remaining`) and returns
`[{ userId, consumptionCount, remaining, updatedAt }]` for that quota in **one
query** — no per-user fan-out. run.human calls it for `gpx_upload` (and optionally
`gpx_save`, `gpx_share`) and joins by `userId`. This is what lets the dashboard
sort/filter by gpx usage **across all users**, not just a page.

### 3. Admin page — `app/admin/page.tsx`

Server component. Admin-gated. Renders:

- **Summary tiles:** total users · new signups (7d) · active (7d) · users with any
  gpx activity.
- **User table** (paginated, sortable, one row per user):
  displayName · email (masked, click to reveal) · **bib code (`runnerCode`)** ·
  **runner QR URL** · signed-up (`createdAt`) · last login (`lastLoginAt`) · last
  activity · check-ins (`checkInCount` / `lastCheckInAt`) · gpx routes/saves/shares ·
  uploads · services.
  - **Runner QR URL** = the link the QR encodes, built from the RunUser `hash`:
    `https://run.<siteDomain>/<REGION_SHORT>/r?h=<hash>` (see
    `run-user.ts:191`). Rendered as a clickable/copyable link. The `eqr` field is
    the pre-rendered QR-image data-URL of that same link — available for an inline
    QR thumbnail on row expand, but the plain URL is the primary column.
  - **Bib code (`runnerCode`)** = the runner's bib code from the Bib entity, via
    `getRunnerCode(userId)` (resolves adapter id → OIDC sub → Bib). Blank for users
    without a bib.
- **Sort:** any column; default "last activity" desc. Flip to "gpx routes desc" to
  find heavy gpx users, "signup desc" for newest.
- **Search box:** matches full email server-side → filters to that user. Emails are
  never rendered unless explicitly revealed.
- **CSV export:** a "Download CSV" button exports the table. It exports the
  **current filtered/sorted view** (all matching rows, not just the visible page).
  Columns match the table, one row per user. Because the CSV is an admin-only
  download (behind the same gate) and its purpose is offline analysis, it contains
  **full emails, full runner QR URLs, and bib codes** — masking is an on-screen
  shoulder-surfing measure, not an access control, and an admin can already reveal
  any row. Generated server-side by the admin users API (`format=csv`), streamed
  with `Content-Disposition: attachment`; filename includes the date. Timestamps
  formatted as ISO for spreadsheet friendliness.

"Last activity" = max of (`updatedAt`, `lastLoginAt`, `lastCheckInAt`) available on
the RunUser record.

## Data sources (all read-only)

| Signal | Source | Notes |
|---|---|---|
| User list, signup, activity | `RunUser` scan (`run-human-electro`) | `displayName`, `createdAt`=signup, `lastLoginAt`, `lastCheckInAt`, `checkInCount`, `updatedAt` |
| Email (masked/search) | Auth.js adapter table (`run-human-authjs`, `USER#`) | run.human's own table; same `userId` key; no cross-app call |
| Uploads | `UserUpload` (`listUploadsByUser`) | gpx/photo counts |
| GPX usage | run.auth quota `gpx_upload`/`gpx_save`/`gpx_share` `consumptionCount` | Via new bulk endpoint (unit 2) |
| Bib code | `getRunnerCode(userId)` → Bib `runnerCode` | Blank if no bib; resolves adapter id → OIDC sub → Bib |
| Runner QR URL | RunUser `hash` → `https://run.<siteDomain>/<REGION_SHORT>/r?h=<hash>` | Link the QR encodes (`run-user.ts:191`); `eqr` is its pre-rendered image data-URL |

## Known limitations (acceptable for v1)

- **GPX counts are approximate.** `consumptionCount` counts consumption *events*
  (uploads/saves/shares), not the live file count; deletions are not reflected. This
  is the deliberate tradeoff for "easy, no run.gpx scan API." An exact per-user
  `GpxFile` scan (real file counts + `lastOpenedAt`/`updatedAt`) can be added later
  as a follow-up column via a run.gpx admin endpoint.
- **User list = RunUser rows.** A user who registered (`AuthProfile`) but never used
  run.human may not have a `RunUser` row yet. That's consistent with "focus on
  run.human users." If we later want *all* sign-ups, `AuthProfile` is the truer
  source.
- **RunUser has no list-all GSI**, so the list uses a `.scan` (ElectroDB
  auto-filters by entity). Fine at event scale (hundreds–low-thousands); revisit if
  it grows.
- **Bib code is a per-user two-hop resolve** (`getRunnerCode`: adapter id → OIDC
  sub via the authjs accounts table → Bib). Doing this per row is N fan-out, same as
  the gpx-count problem. Planning should either (a) build a `sub → runnerCode` map
  once (single Bib listing) and join, or (b) resolve bib code lazily on row
  expand — not one blocking call per user in the list.

## Testing

- **Auth gate:** non-admin session → 404 on page and API; admin session → 200.
  Revalidation-on-entry: simulate a session whose cached claim says admin but fresh
  claims say non-admin → denied.
- **API shape:** users list returns masked emails by default; reveal returns full;
  search by full email returns the matching user only.
- **Bulk gpx endpoint:** returns rows for the quotaId; internal-secret required.
- **Sort/paginate:** sort by gpx routes desc surfaces heavy users; pagination stable.
- **CSV export:** admin-gated; `format=csv` returns all filtered/sorted rows (not
  just the page) with full emails; non-admin gets 404; header row + escaping correct.

## Out of scope (future follow-ups)

- Any write/admin action (quota reset, lockout, service grant).
- Exact gpx file counts via run.gpx scan.
- CloudWatch/Phase-40 activity-event drill-downs.
