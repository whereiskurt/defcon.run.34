# Phase 21 Context — App Scaffold + Bib Registration

## Goal (from ROADMAP)

A logged-in participant creates a bib with a `runnerCode`, edits their `nameOnBib`, and sees the live preview render with the DC34 bib template.

## Success Criteria (verbatim from ROADMAP Phase 21)

1. Next.js webapp scaffold exists at `apps/run.bib/webapp/` mirroring run.flash (app shell, providers, theme, fonts) and builds with `next build`
2. `Bib` + `BibReconcile` ElectroDB entities defined on the shared `run-human-electro` table with the schemas from the design contract
3. Account-linked: login required (via run.gpx auth pattern with cookie + claim renamed to `bib`); one bib per account (idempotent create)
4. Registration UI renders as a DC34-branded race bib (SVG template) with live preview updating as user types
5. Primary display area shows `1337` placeholder until `nameOnBib` non-empty, then shows the name (auto-shrink ≤ 32 chars)
6. `runnerCode` (BIB-XXXX) generated at first bib creation, stored immutably, shown to user
7. API routes: `POST /api/bib` (create, idempotent per user), `PATCH /api/bib` (name edit, blocked when `nameLocked=true`), `GET /api/bib` (fetch signed-in user's bib)
8. Access gated using the run.gpx auth pattern (copied `config/auth.ts` + `middleware.ts` + `signin`/`access-denied`, renamed to `bib`)

## Locked Design Decisions (from Kurt via v1.5 design contract)

- **1 bib per account** — keyed by `ownerSub` (OIDC subject); create is idempotent.
- **Name editable until admin lock** — `nameLocked` bool is a per-record admin flag; PATCH must 409 when locked.
- **`runnerCode`** — 4-char alphanumeric BIB-XXXX slug; stable per-user, IMMUTABLE (only ever written at first create).
- **`paidAmount`** — cents integer, initialized 0; Phase 22 payment webhooks accumulate.
- **`paidStatusHistory`** — list of `{provider, amount, timestamp, reconciled_via}`; Phase 22 populates. Phase 21 initializes as `[]`.
- **`BibReconcile`** — separate entity keyed by `receiptId` (Message-ID hash). Phase 21 defines the entity + schema; Phase 22 populates via SES Lambda.
- **Login required** — no anonymous path. Middleware gates the whole app minus `/signin`, `/access-denied`, `/api/auth/*`, and `/api/health`.

## Auth Mirror Pattern (from run.gpx)

- Copy `apps/run.gpx/webapp/src/config/auth.ts` → `apps/run.bib/webapp/src/config/auth.ts`
- Rename cookie prefix from `_gpx` → `_bib` in all 4 cookie definitions (`sessionToken`, `csrfToken`, `callbackUrl`, `state`)
- Rename env vars `GPX_PUBLIC_URL` → `BIB_PUBLIC_URL`, `LOCAL_GPX_PORT` → `LOCAL_BIB_PORT`
- Rename debug prefix `[run.gpx]` → `[run.bib]`
- Register `bib` OIDC client in `run.auth` — deferred to Phase 20 close-out follow-up OR into Plan 21-01 as a scope check (Kurt confirmed Phase 20 wired SSM secrets but not the OIDC client entry; add to Plan 21-01 as a task).
- `signin` page + `access-denied` page: copy verbatim from `apps/run.gpx/webapp/src/app/signin/` and `apps/run.gpx/webapp/src/app/access-denied/`, string-swap `gpx` → `bib`.

## Entity Pattern (from run.human/webapp/src/entities/)

- `client.ts` — the ElectroDB DynamoDB client + `ELECTRO_TABLE = "run-human-electro"`. Copy to `apps/run.bib/webapp/src/entities/client.ts` (identical — same shared table).
- `checkin.ts` — reference model for the entity structure (attributes + indexes + `createXxx/getXxx/updateXxx` helpers).
- `Bib` entity: `service: "run"` (shared with checkin/run-user), `entity: "Bib"`, `version: "1"`. PK `ownerSub`; SK is a fixed literal (single-record-per-user pattern) or empty composite.
- `BibReconcile` entity: `service: "run"`, `entity: "BibReconcile"`, `version: "1"`. PK `receiptId`. Secondary index by `matchedOwnerSub` (Phase 22 will scan by status too — Phase 21 wires primary + owner index).
- `runnerCode-index` GSI: infrastructure defined in `infra/terraform/live/site/services/run.human/service.hcl:288` — Phase 21 wires the entity's `byRunnerCode` index to that GSI. Field name `runnerCode` as hash_key.

## Files Phase 21 Will Touch (create)

- `apps/run.bib/webapp/` — entire app scaffold (package.json, next.config.js, tsconfig, tailwind config, postcss, .env.local example)
- `apps/run.bib/webapp/src/config/auth.ts` — auth mirror
- `apps/run.bib/webapp/src/middleware.ts` — access gate
- `apps/run.bib/webapp/src/app/{layout,page,providers}.tsx` — shell + providers
- `apps/run.bib/webapp/src/app/signin/page.tsx`, `apps/run.bib/webapp/src/app/access-denied/page.tsx`
- `apps/run.bib/webapp/src/app/api/auth/[...nextauth]/route.ts` — Auth.js handler
- `apps/run.bib/webapp/src/app/api/bib/route.ts` — GET + POST + PATCH handlers
- `apps/run.bib/webapp/src/entities/client.ts` — ElectroDB client (copy of run.human's)
- `apps/run.bib/webapp/src/entities/bib.ts` — Bib entity + `getBib`/`createBib`/`updateBibName`
- `apps/run.bib/webapp/src/entities/bib-reconcile.ts` — BibReconcile entity + helper stubs (Phase 22 fills)
- `apps/run.bib/webapp/src/lib/runner-code.ts` — BIB-XXXX generator (4 alphanumeric chars, collision-safe query by runnerCode-index)
- `apps/run.bib/webapp/src/components/BibPreview.tsx` — live-preview SVG component
- `apps/run.bib/webapp/src/components/BibForm.tsx` — name input driving BibPreview
- `apps/run.bib/webapp/Dockerfile.webapp` — mirrors run.flash Dockerfile (Next.js build + standalone runtime)
- `apps/run.bib/webapp/VERSION` — image tag seed
- `apps/run.bib/nginx/` — reverse proxy container (mirror run.flash/nginx if applicable)

## Files Phase 21 Will NOT Touch

- `infra/terraform/live/site/services/run.bib/service.hcl` — Phase 20 already wired it; Phase 21 only adds env-var references (via Phase 20 SSM params). Phase 21 does not modify the service.hcl unless a critical env var is missing.
- SES receive rule + Haiku Lambda — that's Phase 22.
- Stripe/Venmo/CashApp payment code — Phase 22.
- Multi-region deploy — Phase 23 (Phase 21 targets us-east-1 only).
- `apps/build.sh`, `apps/deploy.sh`, `apps/release-all.sh`, `.github/workflows/*.yml` — v1.5 CI wiring already landed in PR #230 (separate).

## Out of Scope for Phase 21

- Payments (Stripe, Venmo, CashApp handles) — Phase 22
- SES Lambda + Haiku reconciliation — Phase 22
- Admin `nameLocked` UI (setting the flag) — deferred to admin-controlled global flag in Phase 23 or v1.6
- `nameOnBib` ≥ $10 gating logic on physical print — deferred to Phase 22 (Phase 21 initializes `paidAmount=0` so no bib qualifies yet)
- Deploy verification against bib.defcon.run in AWS — Phase 23
- Shareable `/bib/{ownerSub}` URL + QR — deferred to v1.6

## Dependencies

- Phase 20 (merged in #228): bib subdomain + ECR repos + service.hcl + 5 SSM params + `runnerCode-index` GSI + SES receive rule
- run.gpx and run.human: source patterns for auth mirror + entities
- Kurt-side: OIDC client `bib` registration in run.auth (config/oidc.ts + index.ts) — flag as Plan 21-01 task or Blocker if not landed in Phase 20 close.
