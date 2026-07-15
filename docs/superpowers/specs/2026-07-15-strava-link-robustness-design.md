# Strava Link Robustness — Design

**Date:** 2026-07-15
**Status:** Approved (lean process)
**Related:** run.auth v0.0.42 (PR #629/#630) shipped `pruneNullish()` at the AuthProfile write boundary.

## Problem

Strava links complete OAuth (account record persists) but the `AuthProfile.strava` map — the thing run.human reads (`strava.id` → `linked_providers` claim → `session.user.hasStrava`) — frequently never got written. Root cause: optional Strava athlete fields (`city`/`state`/`country`) come back `null`; the non-nullable `string` schema made ElectroDB reject the whole upsert.

Prod impact measured 2026-07-15: **11 of 13 Strava-linked users (85%) have an OAuth account but no `strava.id` in their profile** — shown disconnected in run.human. The shipped `pruneNullish()` prevents *new* breakage but does not heal the existing 11.

## Principle

The **athlete `id` is the only field required to mean "linked."** Everything else (name, avatar, city/state/country) is best-effort enrichment that must **never** be able to block or unlink.

## Component 1 — Minimum-link contract in code

**New pure helper** `buildStravaLink(raw)` in `entities/auth-profile.ts` (exported, unit-testable):

- Reads the raw Strava athlete object (snake_case: `id`, `username`, `firstname`, `lastname`, `profile_medium`, `city`, `state`, `country`).
- `id`: coerced via `Number(raw.id)`; **throws** iff `!Number.isFinite(id)` — the single genuinely-required field.
- Every optional field: included **only if `typeof === "string"` and non-empty**, else dropped. Stricter than `pruneNullish` — immune to `null`, numbers, objects, anything non-string.
- Returns the entity `strava` map shape (camelCase) minus `linkedAt` (added by `upsertAuthProfile`).

**Wiring:** `config/auth.ts` Strava branch replaces the hand-built map with `strava: buildStravaLink(profile)`. `stravaProfile: profile` (raw, `type:"any"`) is unchanged. The `.catch` log stays.

**Tests** (`auth-profile.test.ts`, table-driven, mocked DynamoDB client so real ElectroDB validation runs):

| Case | Assert |
|------|--------|
| all-null location | link records, `strava.id` present, no city/state/country |
| `city` as a number | link records, city dropped |
| missing name fields | link records with id + whatever valid strings |
| id-only (nothing else) | link records, just `id` |
| `id` as numeric string `"123"` | link records, `id === 123` (number) |
| `id` missing/`NaN` | `buildStravaLink` throws (can't link without id) |

Existing null-location regression test retained.

## Component 2 — Backfill the 11 broken users

**Operator script** `apps/run.auth/webapp/scripts/backfill-strava-links.mts` (pattern: `sync-bib-names.mts`, `reset-ctf-user.mts`).

1. Scan `run-auth-authjs` for `provider="strava"` → `{ userId, athleteId = providerAccountId (N) }`.
2. For each: read `AuthProfile` via the ElectroDB entity. **Skip if `strava.id` already set** (idempotent; the 2 working users untouched).
3. Else `AuthProfile.patch({ userId }).set({ strava: { id: athleteId, linkedAt: <run time> } }).go()` — writes **only** the minimal link; never touches `services`, `name`, or other fields.
4. **Dry-run by default**; `--confirm` applies. Logs every planned/applied write and a final summary.

**Execution:** run against prod `run-auth-electro` with `dc34-application` SSO creds; handle known gotchas (stale `AWS_CREDENTIAL_EXPIRATION`; prod `.env` points at `localhost:8888` so do not load it). Dry-run first, review the 11, then `--confirm`.

**Post-run:** healed users flip to connected in run.human on their next claims refresh (login / window-focus / ~5-min token refresh) — no re-link required. `linkedAt` = backfill time (original unknown; display-only, not the link signal).

## Out of scope (deferred)

- CloudWatch alarm on Strava write failures.
- `token.email != ""` gate cleanup on the Strava branch (not the culprit; `undefined != ""` is `true`).

## Delivery

- Code (Component 1) + script (Component 2) + this spec on one branch → PR → merge → `buildpub` + `deploy.yml` (run.auth, use1), same recipe as v0.0.42.
- Backfill run is a data operation (no deploy) — can run as soon as the script is tested; Component 1 need not be deployed first.
