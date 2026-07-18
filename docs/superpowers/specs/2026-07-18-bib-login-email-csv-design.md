# Bib print-names CSV: authoritative login email + QRCode columns

**Date:** 2026-07-18
**Apps:** run.auth, run.bib
**Branch:** `fix/bib-csv-login-email`

## Problem

The admin print-names CSV (`bib.defcon.run/use1/admin` → print-names download) has
an `email` column that is **blank for some paying, named bibs**. Kurt flagged this
as "impossible" — a bib owner must have authenticated, so they must have an email.

### Root cause

`email` is **not** bib data. The Bib entity stores only `ownerSub` (the OIDC
subject); it has no email field, and run.bib uses **pure-JWT sessions with no
database adapter**, so it never persists the login email at all.

The CSV's `email` is a live cross-service join into **run.human**
(`admin-report-enrich.ts` → `getRunnerContact(ownerSub)` →
`run.human /api/internal/user/{ownerSub}`). run.human only has an email if the
runner **also signed into the main app**. A runner who only ever used
`bib.defcon.run` has no run.human account, so the lookup 404s and the cell is
blank. Because email and `qrUrl` came from the *same* run.human call, both blank
together — the tell seen in the export.

### The authoritative source

Every bib owner authenticated through **run.auth** (the OIDC provider), which
holds their `email` on the `AuthProfile` entity (PK = `userId`). run.bib's
`ownerSub` **is** the `AuthProfile` key — proven: bib already calls
`getAuthProfile(sub)` via `/api/session/validate/user/{sub}` for session claims
and it resolves. So `AuthProfile.email` is present for **every** bib and is the
correct source.

## Changes (2 apps, no infra)

### 1. run.auth — expose email on the internal validate endpoint
`apps/run.auth/webapp/src/app/api/session/validate/user/[userId]/route.ts`
- Add `email: profile.email ?? null` to the response `user` object and to the
  `InternalValidateResponse` type.
- Additive + backward-compatible (existing callers ignore the new field).
  Secret-gated (`X-Internal-Secret`) server-to-server, as today.
- Chosen over a new dedicated endpoint because bib already calls this exact path
  with the internal secret — zero new routing/secret/env plumbing.

### 2. run.bib — source email from run.auth, QR still from run.human
- New `apps/run.bib/webapp/src/lib/runner-email.ts`:
  `getRunnerEmail(ownerSub): Promise<string | null>` — calls run.auth
  `…/api/session/validate/user/{sub}` reusing the existing `AUTH_INTERNAL_URL` /
  `AUTH_INTERNAL_SECRET` envs and the same URL derivation as `config/auth.ts`'s
  `fetchFreshClaims`. Fail-open: any non-2xx / network error / missing field → `null`.
- `apps/run.bib/webapp/src/lib/admin-report-enrich.ts`: for each row, fetch
  **email from run.auth** and **hash/qrUrl from run.human** concurrently. `email`
  ← run.auth; `qrUrl` ← run.human (unchanged). The two are now independent, so a
  run.human miss no longer blanks the email. Empty `ownerSub` → both blank, no calls.

### 3. run.bib — QRCode columns
`apps/run.bib/webapp/src/lib/admin-reports.ts` `reportToCsv` print-names case:
append two columns after `qrUrl`: `QRCode1`, `QRCode2`, always blank (keys absent
on rows → empty cells via `csvCell(undefined)`).

Final header:
`name, runnerCode, paidUsd, printEligible, nameLocked, paymentTypes, email, qrUrl, QRCode1, QRCode2`

## Tests (TDD, written first)
- `runner-email.test.ts` — parses email; fail-open → null on non-2xx / throw / blank.
- `admin-report-enrich.test.ts` — email from run.auth mock; qrUrl from run.human
  mock; run.human miss keeps email populated; empty ownerSub → both blank, no calls.
- `admin-reports.test.ts` — print-names CSV has `QRCode1` / `QRCode2` headers with
  blank cells.
- run.auth validate/user route test — response includes `email`.

## Delivery
Build, tests green (Node 22.12 for vitest@4), PR on `fix/bib-csv-login-email`.
**No merge / deploy without Kurt's approval.** Deploy = run.auth + run.bib → use1.

## Not doing (YAGNI)
- No run.human fallback for email (run.auth is authoritative and universal).
- No change to the live admin dashboard (enrichment is CSV-download-only).
- No new infra / env (bib already has `AUTH_INTERNAL_URL` + `AUTH_INTERNAL_SECRET`).
