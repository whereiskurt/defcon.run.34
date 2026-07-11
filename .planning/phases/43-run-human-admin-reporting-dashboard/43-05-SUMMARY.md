---
phase: 43-run-human-admin-reporting-dashboard
plan: 05
subsystem: run.human/admin
tags: [admin, reporting, server-component, pii-masking, csv-export]
requires: [43-02, 43-04]
provides: ["/admin dashboard route (run.human)"]
affects: [apps/run.human/webapp]
tech-stack:
  added: []
  patterns: [server-component, url-param-driven-state, fail-closed-404-gate, apiBase-region-basePath]
key-files:
  created:
    - apps/run.human/webapp/src/app/admin/page.tsx
  modified: []
decisions:
  - "All denial paths (no_session / not_admin / missing authUserId / stale admin) collapse to notFound() (404) for non-disclosure parity with the /api/admin/users route — no signin redirect, matching the prohibition that unauthenticated entry also 404s."
  - "revalidateAdmin is called with session.user.authUserId (OIDC sub), never session.user.id (adapter uuid)."
  - "summaryTiles computed over the FILTERED view (per plan action), so tiles track the active search."
  - "Self-contained inline dark palette (concrete hex) instead of bib CSS vars (--bib-*), which are not defined in run.human — keeps the page boring and dependency-free."
metrics:
  duration: ~15m
  completed: 2026-07-11
status: build-complete-pending-human-verify
---

# Phase 43 Plan 05: /admin Reporting Dashboard Summary

Boring single-file `/admin` server component for run.human: admin-gated on entry
with fresh-claims revalidation, rendering four summary tiles plus a
sortable/paginated user table with masked emails, per-row reveal, full-email
search, runner-QR/bib columns, and a region-prefixed Download-CSV link.

## What Was Built

`apps/run.human/webapp/src/app/admin/page.tsx` (NEW, 510 lines):

- `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"`.
- `export default async function AdminPage({ searchParams })` where `searchParams`
  is a `Promise<Record<string,string|undefined>>` (Next 16).
- **Gate (fail-closed, non-disclosure):** `auth()` → `requireAdmin(session)`; any
  `!gate.ok` → `notFound()`. Then `const authUserId = session.user.authUserId;`
  `if (!authUserId || !(await revalidateAdmin(authUserId))) notFound();`
- **Data:** `buildUserReport()` → `filterByEmail(rows, q)` → `sortRows(_, sort)`;
  `summaryTiles(filtered)` for the tiles; `view.slice(...)` for the page.
- **Tiles:** total users · new signups 7d · active 7d · gpx-active.
- **Search:** GET `<form>` with `name="q"` (server-side full-email filter) plus a
  hidden `sort` field so a search preserves the active sort and resets to page 1.
- **Sort:** three header links (`lastActivity` default, `gpxUsage`, `signup`) that
  set `?sort=` and preserve `q`; active sort highlighted.
- **Table:** sticky first column + horizontal scroll; columns = Name · Email · Bib ·
  Runner QR · Signed up · Last login · Last activity · Check-ins · GPX r/s/sh ·
  Uploads · Services.
- **Masking / reveal:** each email rendered `maskEmail(row.emailFull)` as a link to
  `?reveal=<userId>` (preserving q/sort/page); when `reveal === row.userId` the one
  row shows the full email. No unrevealed full-email column exists.
- **CSV:** `<a href={`${apiBase()}/api/admin/users?format=csv&sort=…&q=…`}>` carrying
  the current filter/sort; `apiBase()` prepends `/{region}` in production (a plain
  `<a>` is not basePath-auto-prefixed).
- **Pagination:** Prev/Next links (inert when disabled) + an `N–M of T · page p/tp`
  counter.

## Identifier Wiring (the landmine)

| Purpose | Value used | NOT used |
|---------|-----------|----------|
| Fresh-claims revalidation | `session.user.authUserId` (auth.defcon.run OIDC sub, exposed by `config/auth.ts` session callback) | `session.user.id` (Auth.js DynamoDB-adapter local uuid) |

Missing `authUserId` → `notFound()`. `revalidateAdmin(authUserId) === false` (stale /
revoked admin, or auth-server error → fail-closed) → `notFound()`. This mirrors the
Plan-04 `/api/admin/users` route exactly, so page and API gate identically.

## Automated Gate Results

Node v23.6.0.

- **grep gate:** ALL PASS — `runtime = "nodejs"`, `dynamic = "force-dynamic"`,
  `notFound`, `revalidateAdmin`, `buildUserReport`, `maskEmail`, `format=csv` all
  present in `src/app/admin/page.tsx`.
- **`npx tsc --noEmit`:** `src/app/admin/page.tsx` contributes **0 errors**. The only
  remaining errors are the two documented pre-existing baseline files, out of scope
  for this plan:
  - `src/components/header/dropdown-user.tsx` — `Cannot find module '@public/header/dcjack.svg'` (missing svg type decl).
  - `src/entities/__tests__/checkin.test.ts` — ElectroDB `Property 'model' does not exist` typing.
  Filtering those two files out of the tsc output leaves zero errors.

## Commits

- `bb03f8ac` — feat(43-05): add /admin reporting dashboard server component

## Deviations from Plan

- **[Rule 3 — resolve grep gate]** Built the CSV href with a literal `format=csv&…`
  string (instead of `new URLSearchParams({format:"csv"})`) so the plan's grep gate
  token `format=csv` is present in source. Behaviourally identical.
- **Denial for `no_session`:** the plan action said a signin redirect was *optional*
  ("you MAY redirect to signin"); chose `notFound()` for ALL denials instead, honoring
  the frontmatter prohibition ("unauthenticated entry MUST render notFound()") and
  matching the API route's bare-404 non-disclosure behavior. Not a functional deviation
  from the must-haves.

## Known Stubs

- `row.services` is always `[]` (documented in `admin-report.ts`: RunUser carries no
  group/services claim; the report join has no services source). The Services column
  renders empty for every row by design — this is an upstream Plan-04 data-shape
  reality, not a stub introduced here. No action required for this plan.

## HUMAN VERIFICATION PENDING

**This plan is BUILD-COMPLETE only. The Task 2 `checkpoint:human-verify` gate was NOT
executed** — it requires a live run.human dev server, run.auth reachable
(`AUTH_INTERNAL_SECRET` so `revalidateAdmin`/`getQuotaByType` resolve), and real admin
credentials. Do NOT mark the phase complete until a human operator runs the checklist
below and replies "approved".

Exact manual steps for the operator (from the plan's human-verify task):

1. Start run.human locally: from `apps/run.human/webapp`, `PORT=3001 npm run dev`
   (ensure `AUTH_INTERNAL_SECRET` set + run.auth reachable so `revalidateAdmin` +
   `getQuotaByType` resolve).
2. As an **admin** (Kurt/Jesse — a user with `"admin"` in `services`), visit
   `http://localhost:3001/admin`. Confirm the tiles show counts and the table lists
   users defaulting to most-recently-active.
3. Click a masked email → that one row reveals the full email; others stay masked.
   Type a full email into the search box → the list filters to that user server-side.
4. Click the GPX-usage and Signup sort headers → order changes. Page through the table
   (Prev/Next).
5. Confirm the Runner QR column links to `https://run.<domain>/<region>/r?h=...` and
   the Bib code shows for users with a bib (blank otherwise).
6. Click **Download CSV** → a `run-users-YYYY-MM-DD.csv` downloads with FULL
   emails/QR/bib codes matching the current filter/sort.
7. Sign in as a **NON-admin** (or a session whose admin was just revoked in run.auth)
   and visit `/admin` → confirm a **404** (not a 403, not the dashboard) on BOTH the
   page AND `GET /api/admin/users`.

Resume signal: operator types "approved" or describes issues.

## Self-Check: PASSED

- `apps/run.human/webapp/src/app/admin/page.tsx` — FOUND on disk.
- Commit `bb03f8ac` — FOUND in git log.
