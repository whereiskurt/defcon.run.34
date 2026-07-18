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
- `run.human scripts/backfill-run-human-identities-offline.test.mts` (ask #1) —
  **fully-offline** operator backfill, gated (`describe.skipIf(!BACKFILL_MODE)`)
  so the suite/CI never runs it. Scans bibs (run-human-electro) + accounts
  (run-human-authjs) + emails (run-auth-electro) via SSO, then provisions each
  named bib-only runner reusing the REAL code pointed at prod: the Auth.js adapter
  constructed on an SSO client + the real `upsertRunUser`/`RunUser` entity
  re-pointed with ElectroDB `setClient()`. No deployed endpoint, no record forging.

  Runner note: **only vitest resolves both** the adapter's ESM `exports` map AND
  the app's extensionless imports (`tsx` fails the former, `node` the latter).
  Creds note: prod uses IAM roles — there are **no static prod keys**; the local
  `.env` points at `localhost:8888` dev DynamoDB (a first run wrote 10 harmless
  users THERE before this was caught). So writes go through the SSO profile, not
  `entities/client.ts` (which is hardcoded to static keys). `creationSeed` resolves
  to the `"default-seed"` fallback — verified prod uses it (an existing RunUser's
  mqttUsername matches the default-seed derivation), so creds/hash are byte-identical.

  Names: the backfill provisions the identity; the existing `sync-bib-names.mts`
  (run against prod via SSO, no `--env-file`) then overwrites each `rabbit_XXXX`
  with the bib name, respecting the lock policy.

## Delivery / order
- **Backfill: DONE 2026-07-18** — 10 named bib-only runners provisioned in prod
  (offline via SSO), then 13 rabbit names synced (10 new + 3 pre-existing). Verified:
  0 candidates remain; sample (OGRE) resolves account→RunUser→hash and shows the bib name.
- **PR (Part A + Part B code): NOT deployed.** Merge + buildpub run.bib + run.human →
  use1 when ready. This activates: the qrUrl runnerCode fallback (Part A) and the
  PATCH auto-provision so FUTURE bib runners self-provision (Part B, ask #2 — dormant
  until deployed). The offline backfill needs no deploy.

## Consent note
This creates run.human accounts for people who only signed up for a bib. Kurt's
product call; flagged. Profiles are minimal (bib name + QR), and the existing
bib→rabbit name sync means they aren't empty.

## Tests
- run.bib 315 pass (qrUrl fallback + existing). run.human 797 pass (ensure-identity,
  auth-email, PATCH provisioning + updated canonical route test). Changed files tsc clean.
