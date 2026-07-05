---
phase: 35
plan: 03
subsystem: run.cms
tags: [strapi, permissions, api-token, ui-string, copy-catalog, security]
status: complete
requires:
  - "35-01 (api::ui-string.ui-string content type + ui_strings table)"
provides:
  - "Public role denied find/findOne on api::ui-string.ui-string at every bootstrap (all modes)"
  - "Verified 200/403 access matrix: read-only token reads, writes denied, anonymous denied"
affects:
  - "36 (copy toolkit reads the catalog with the run-human-internal read-only token gated here)"
tech_stack:
  added: []
  patterns:
    - "Extended existing revokePublicPermissions() deny list (no new mechanism)"
    - "Strapi read-only API token auto-covers find/findOne for new content types (verified empirically, not by widening the grant)"
key_files:
  created: []
  modified:
    - apps/run.cms/app/src/index.ts
decisions:
  - "No token-grant change needed: the read-only token type dynamically covers ui-string find/findOne (empirical GET → 200), matching the plan's expected outcome"
  - "Runtime matrix verified by booting compiled dist programmatically against a throwaway copy of the dev SQLite DB with an ephemeral read-only token — no live master/SSM env required"
metrics:
  duration: 6m
  tasks: 2
  files: 1
  completed: 2026-07-05
requirements: [COPY-03]
---

# Phase 35 Plan 03: Gate ui-string Behind Read-Only Token + Deny Public Summary

Gated the `ui-string` copy catalog behind the existing `run-human-internal` read-only API token and denied the anonymous Public role, mirroring the posture already applied to `route`/`event`/`point-of-interest` — a two-line extension of `revokePublicPermissions()` plus empirical confirmation that the read-only token already covers the new content type without widening its grant.

## What Was Built

**Task 1 — Deny the Public role on ui-string find/findOne (`feat`, commit 2bc0b097)**
Extended the `publicActions` array in `revokePublicPermissions()` (`src/index.ts`) with `api::ui-string.ui-string.find` and `api::ui-string.ui-string.findOne`, alongside the existing route/event/point-of-interest entries. The existing idempotent loop (checks `existing && existing.enabled` before disabling) handles the new entries automatically. `revokePublicPermissions()` runs for ALL bootstrap modes (it is not inside the `mode === 'master'` block), so both master and worker nodes deny the Public role. `ensureApiTokenPublished()` was left untouched — the token grant was not widened.

**Task 2 — Empirical verification of the read-only token access matrix (no code change)**
Booted the compiled `dist` build programmatically (`createStrapi({ distDir: 'dist' }).load()`) against a throwaway copy of the dev SQLite DB, minted an ephemeral `type: 'read-only'` API token via `admin::api-token`, seeded a published `ui-string` row, and exercised the full HTTP matrix against `/api/ui-strings`. Result confirmed the plan's expected outcome exactly: the read-only token type auto-covers `find`/`findOne`, so **no** grant change was required.

## Observed 200/403 Access Matrix

| Request | Auth | Observed | Expected |
|---------|------|----------|----------|
| GET `/api/ui-strings` (find) | read-only token | **200** | 200 |
| GET `/api/ui-strings/:id` (findOne) | read-only token | **200** | 200 |
| POST `/api/ui-strings` (create) | read-only token | **403** | 403 |
| PUT `/api/ui-strings/:id` (update) | read-only token | **403** | 403 |
| DELETE `/api/ui-strings/:id` | read-only token | **403** | 403 |
| GET `/api/ui-strings` (find) | none (Public) | **403** | 403 |
| GET `/api/ui-strings/:id` (findOne) | none (Public) | **403** | 403 |

Raw result: `{"token_GET_find":200,"token_GET_findOne":200,"token_POST_create":403,"token_PUT_update":403,"token_DELETE":403,"notoken_GET_find":403,"notoken_GET_findOne":403}`

## Verification

- **Task 1 gate (pass):** `grep "api::ui-string.ui-string.find'"` and `.findOne'` both present in `src/index.ts`.
- **Task 2 gate (pass):** `type: 'read-only'` present and public deny present in `src/index.ts`.
- **Runtime matrix (pass):** all seven observed status codes match expectations. Read-only token reads (200), writes denied (403), anonymous denied (403).

## Threat Mitigations Confirmed

- **T-35-01 (Information Disclosure — Public role default-granted read on the new resource):** mitigated. Anonymous GET → 403 at every bootstrap. (Note: newly created Strapi content types default Public perms to disabled; the explicit deny is belt-and-suspenders that also revokes the permission if it is ever manually enabled in the admin UI.)
- **T-35-02 (Elevation of Privilege / Tampering — write via read-only token):** mitigated. Token minted `type: 'read-only'` (unchanged); POST/PUT/DELETE → 403. Grant not widened for writes.

## Deviations from Plan

None — plan executed exactly as written. Task 2 required no code change, which is the plan's stated expected outcome (read-only auto-covers find/findOne).

## Verification Method Notes (for reviewers)

The runtime matrix was produced by a temporary CommonJS harness (removed after the run) that:
- Copied `.tmp/data.db` to `/tmp/uistring-verify.db` so the real dev DB was never mutated.
- Booted from the compiled `dist` (avoids the Strapi `.mjs` `lodash/fp` directory-import failure under Node 22 and the TS-config-loader requirement of a raw `load()`); the compiled `dist/src/index.js` — a gitignored build artifact — was synced with the same two array entries so the running bootstrap matched source.
- Supplied ephemeral secrets (APP_KEYS/API_TOKEN_SALT/etc.) and port 1338; token hash/verify used the same in-process salt, so the matrix is self-consistent.
- All temp files (`.uistring-verify.cjs`, `/tmp/uistring-verify.db`, logs) were removed; working tree is clean.

## Known Stubs

None.

## Self-Check: PENDING
