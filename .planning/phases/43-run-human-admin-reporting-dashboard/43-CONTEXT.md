# Phase 43: run.human Admin Reporting Dashboard - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning
**Source:** PRD Express Path (docs/superpowers/specs/2026-07-11-run-human-admin-dashboard-design.md)

<domain>
## Phase Boundary

Deliver a **read-only** admin reporting dashboard at `run.defcon.run/admin`, visible
only to users with `"admin"` in their `services` list (currently Kurt & Jesse). It
lists run.human users with sign-up, activity, and gpx-usage signals so admins can
find who signed up and who is actively using gpx / a given service. Email is
searchable but masked on screen.

**In scope:** the `/admin` page + supporting admin API in run.human; a small new
read-only bulk quota endpoint on run.auth; the auth gate with entry-time
revalidation; masked/searchable email; sortable/paginated user table; CSV export.

**Out of scope (v1):** any write/admin action (quota reset, lockout, service grant,
edit, impersonate, delete); exact gpx file counts via a run.gpx scan API;
CloudWatch/Phase-40 activity-event drill-downs; i18n.
</domain>

<decisions>
## Implementation Decisions

All items below are **locked** (carried from the approved design spec).

### Authorization gate
- Gate on `session.user.services.includes("admin")` — mirror the helper shape in
  `apps/run.bib/webapp/src/lib/admin-gate.ts` (`isAdmin` / `requireAdmin`). Do NOT
  reintroduce an email allowlist; admin is a DynamoDB-backed `services` membership.
- On `/admin` **entry**, force a **synchronous fresh-claims revalidation** against
  run.auth (`GET {privateAuthServer}/api/session/validate/user/{userId}`, using the
  existing `fetchFreshClaims`/internal-secret path in `config/auth.ts`) so a
  just-revoked admin cannot linger within the ~5-min JWT staleness window.
- Non-admins (and unauthenticated) get a **404**, not a 403 — do not advertise the
  route exists. Applies to both the page and the API routes.

### User list & activity
- Primary list = a `RunUser` **scan** over `run-human-electro` (ElectroDB
  auto-filters by entity). There is no list-all GSI; a scan is acceptable at event
  scale (hundreds–low-thousands).
- Attributes surfaced per user: `displayName`, `createdAt` (=signup), `lastLoginAt`,
  `lastCheckInAt`, `checkInCount`, `updatedAt`.
- "Last activity" = max of (`updatedAt`, `lastLoginAt`, `lastCheckInAt`) present on
  the RunUser record.
- Uploads (gpx/photo counts) from `UserUpload` via a **single fan-out-free
  `scanAllUploads()`** pass reduced to a `userId → {gpx,photo}` count map — NOT
  per-user `listUploadsByUser` (userId-partitioned + paginated → N fan-out +
  undercount). If the uploads table grows, fall back to lazy-on-row-expand.

### Email (masked / searchable)
- Emails are **not** on `RunUser`; resolve them from run.human's **own** Auth.js
  adapter table (`run-human-authjs`, `USER#` records, same `userId` key) via the
  existing `dynamodbClient` in `entities/client.ts`. No cross-app call for email.
- Table shows emails **masked by default** (e.g. `k•••@gmail.com`). A search box
  matches the **full** email server-side to filter to a user. An individual email is
  revealed only on explicit per-row reveal. No unrevealed full-email column.

### GPX usage (per user)
- Source = run.auth quota service consumption counters for `gpx_upload`, `gpx_save`,
  `gpx_share` (`consumptionCount`). This is the "who uses gpx a lot" signal.
- **Bulk read via a NEW read-only endpoint on run.auth** that queries the existing
  `byQuotaRemaining` GSI (`pk = quotaId`) and returns
  `[{ userId, consumptionCount, remaining, updatedAt }]` in ONE query per quotaId —
  NOT per-user fan-out. run.human joins by `userId`. This enables sorting/filtering
  by gpx usage across ALL users. Internal-secret gated, admin-only.
- Accepted limitation: `consumptionCount` counts consumption events, not live file
  count; deletes are not reflected. Approximate by design.

### Runner QR URL & bib code
- **Runner QR URL** column = the link the QR encodes, built from RunUser `hash`:
  `https://run.<siteDomain>/<REGION_SHORT>/r?h=<hash>` (see `run-user.ts:191`).
  Render as a copyable/clickable link. `eqr` is the pre-rendered QR-image data-URL of
  that same link — optional inline thumbnail on row expand, not the primary column.
- **Bib code** column = Bib `runnerCode` via `getRunnerCode(userId)` (resolves
  adapter id → OIDC sub → Bib). Blank when the user has no bib.
- `getRunnerCode` is a per-user two-hop resolve → avoid N fan-out: either build a
  `sub → runnerCode` map once (single Bib listing) and join, or resolve bib code
  lazily on row expand. Do NOT do one blocking call per row in the list.

### View
- Summary tiles: total users · new signups (7d) · active (7d) · users with any gpx
  activity.
- Table (paginated, sortable): displayName · email (masked, reveal) · bib code ·
  runner QR URL · signed-up · last login · last activity · check-ins · gpx
  routes/saves/shares · uploads · services. Default sort = last activity desc; must
  support gpx-usage-desc and signup-desc.
- Search box filters by full email (server-side).

### CSV export
- "Download CSV" exports the **current filtered/sorted view** (all matching rows,
  not just the visible page), columns matching the table. Server-side via the admin
  users API (`format=csv`), streamed as an attachment with a dated filename, ISO
  timestamps. Because it is an admin-only download behind the same gate, the CSV
  carries **full** emails / QR URLs / bib codes (masking is a shoulder-surfing
  measure, not access control).

### Claude's Discretion
- Exact React component structure, table library vs. hand-rolled, pagination page
  size, mask format, CSV escaping lib, and file layout — follow existing run.human /
  run.bib admin conventions and keep it boring/single-file until proven insufficient.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contract
- `docs/superpowers/specs/2026-07-11-run-human-admin-dashboard-design.md` — the full approved design (source of every locked decision above)

### Auth / admin gate (pattern to mirror)
- `apps/run.bib/webapp/src/lib/admin-gate.ts` — `isAdmin`/`requireAdmin` reference gate
- `apps/run.human/webapp/src/app/api/admin/quota/route.ts` — existing run.human `services.includes("admin")` admin route
- `apps/run.human/webapp/src/config/auth.ts` — `fetchFreshClaims`, session/JWT callbacks, internal-secret validate call (revalidation-on-entry source)
- `apps/run.auth/webapp/src/app/api/session/validate/user/[userId]/route.ts` — the validate endpoint (DynamoDB source of truth)

### run.human data (user list, email, uploads, bib, QR)
- `apps/run.human/webapp/src/entities/run-user.ts` — RunUser entity; `hash`/`eqr` (QR), `createdAt`/`updatedAt`/`lastLoginAt`/`lastCheckInAt`/`checkInCount`; no list-all GSI (scan)
- `apps/run.human/webapp/src/entities/client.ts` — `electroClient`/`ELECTRO_TABLE` and the Auth.js `dynamodbClient`/`DYNAMODB_TABLE` (email source)
- `apps/run.human/webapp/src/entities/user-upload.ts` — `UserUpload`, `listUploadsByUser`/`listUploadsByType`
- `apps/run.human/webapp/src/entities/bib.ts` — `getRunnerCode(userId)` (adapter → sub → Bib)
- `apps/run.human/webapp/src/lib/quota-client.ts` — quota HTTP client; `QuotaId` includes `gpx_upload`/`gpx_save`/`gpx_share`

### run.auth quota (bulk endpoint source)
- `apps/run.auth/webapp/src/entities/user-quota.ts` — `UserQuota`; GSI `byQuotaRemaining` (`pk quotaId`, `sk remaining`) — the bulk-read index
- `apps/run.auth/webapp/src/app/api/admin/quota/[userId]/route.ts` — admin quota read endpoint pattern (auth + shape to mirror for the new bulk endpoint)

### UI analog
- run.bib `/admin` page (admin table/list UI already in the repo) — closest visual analog to follow
</canonical_refs>

<specifics>
## Specific Ideas

- Reuse the run.bib admin-gate idiom verbatim; keep a run.human `admin-gate` helper
  so page + API + CSV share one gate.
- The new run.auth endpoint is the ONLY cross-app addition; everything else stays in
  run.human. Keep it ~30 lines, read-only, internal-secret + admin gated.
- Email masking is presentation-only; search + CSV operate on full emails held
  server-side. Never ship full emails to the client except on explicit reveal.
</specifics>

<deferred>
## Deferred Ideas

- Write/admin actions (quota reset, lockout, service grant, edit, impersonate, delete)
- Exact per-user gpx file counts + `lastOpenedAt` via a run.gpx admin scan endpoint
- CloudWatch / Phase-40 activity-event drill-downs
- i18n / locale switcher
</deferred>

---

*Phase: 43-run-human-admin-reporting-dashboard*
*Context gathered: 2026-07-11 via PRD Express Path*
