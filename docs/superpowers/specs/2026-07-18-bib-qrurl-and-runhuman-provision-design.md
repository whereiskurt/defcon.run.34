# Bib QR: runnerCode fallback + provision run.human identities for bib-only runners

**Date:** 2026-07-18
**Apps:** run.bib, run.human (+ run.auth email endpoint, already shipped)
**Branch:** `fix/bib-qrurl-and-runhuman-provision`
**Follows:** `2026-07-18-bib-login-email-csv-design.md` (email now sourced from run.auth)

## Problem

After the email fix, the print-names CSV still had a **blank `qrUrl` for some
runners**. `qrUrl` is the run.human social-QR `hash`, which only exists on a
`RunUser` record — created only when someone signs into run.defcon.run. A runner
who only ever used bib.defcon.run has no `RunUser`, so no hash, so a blank QR.

The hash is derived from a run.human-only seed, so it **cannot be fabricated** —
the runner genuinely has no run.human profile.

## Two parts

### Part A — CSV qrUrl falls back to runnerCode (interim, ship first)

The *physical* bib is never blank: `BibPreview.stubQrValue = socialQrUrl ||
runnerCode` (SC34.8) — the tear-off QR encodes the bare `runnerCode` when there's
no social QR. The CSV enrichment didn't mirror that.

`admin-report-enrich.ts`: `qrUrl = hash ? buildSocialQrUrl(hash) : row.runnerCode`
(and the no-ownerSub branch also falls back to runnerCode). So the CSV matches
what actually prints. run.bib only.

### Part B — Provision run.human identities for bib-only runners

Kurt's ask: (1) backfill existing bib-only runners so they get a real run.human
profile + social QR, and (2) auto-provision future bib runners.

**The safe mechanism.** Reuse run.human's OWN Auth.js adapter — never forge
DynamoDB records (a schema mismatch would make a later real SSO sign-in create a
DUPLICATE account). `dynamodbAdapter.createUser` + `linkAccount` write the
account with the exact `GSI1PK=ACCOUNT#run.defcon.run` / `GSI1SK=ACCOUNT#<sub>`
keys that `getAdapterUserIdBySub` queries AND that a future real sign-in resolves
via `getUserByAccount`. So a provisioned account is byte-identical to a real one:
later SSO links to it, no duplicate, no orphaned RunUser. `OIDC_PROVIDER =
"run.defcon.run"` is the same constant across read path, write path, and sign-in.

**Components:**
- `run.human lib/ensure-identity.ts` — `ensureRunHumanIdentity(sub, email, name)`:
  `getAdapterUserIdBySub` → if missing, `createUser` + `linkAccount` → always
  `upsertRunUser` (idempotent; generates the RSA keypair + seed + QR hash + mqtt
  creds, same as a normal first login).
- `run.human lib/auth-email.ts` — `getAuthEmailBySub(sub)`: reads the
  authoritative email from run.auth's validate endpoint (needed to mint the
  adapter user). Fail-open → null.
- `run.human PATCH /api/internal/user/[oidcSub]` — the endpoint run.bib already
  calls on every bib name-save. When no account maps to the sub, it now
  **provisions** (email from run.auth, name = bib name) instead of 404, then syncs
  the name. → every FUTURE bib runner self-provisions on their first bib save
  (ask #2). Existing users unchanged (`provisioned: false`). A too-short name
  still provisions the identity (only the name write is skipped).
- `run.human scripts/backfill-bib-run-human-identities.mts` (ask #1) — scans bibs
  + existing authjs accounts (raw SDK, per the sync-bib-names.mts precedent —
  entities can't be imported in a standalone run), then **replays the deployed
  PATCH** for each bib-only runner. Reuses the exact same provisioning path (no
  forging). Dry-run by default, `--confirm` to write, `--sub` to test-drive one.
  The prod internal endpoint is publicly reachable + secret-gated (403 on bad
  secret; middleware excludes `api`), so a laptop run with the secret works.

## Delivery / order
1. Merge PR → main.
2. buildpub run.bib + run.human → use1 (Part A + Part B code live). **run.human
   MUST be deployed before the backfill** (backfill hits the live endpoint).
3. Backfill: dry-run → `--sub` test-drive one → `--confirm` full sweep. Needs
   Kurt's go (creates real prod accounts).

## Consent note
This creates run.human accounts for people who only signed up for a bib. Kurt's
product call; flagged. Profiles are minimal (bib name + QR), and the existing
bib→rabbit name sync means they aren't empty.

## Tests
- run.bib 315 pass (qrUrl fallback + existing). run.human 797 pass (ensure-identity,
  auth-email, PATCH provisioning + updated canonical route test). Changed files tsc clean.
