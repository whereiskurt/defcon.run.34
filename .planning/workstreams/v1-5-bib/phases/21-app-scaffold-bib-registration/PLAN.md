# PLAN — v1.5 Phase 21: App Scaffold + Bib Registration

**Phase goal:** A logged-in participant creates a bib with a `runnerCode`, edits their `nameOnBib`, and sees the live preview render with the DC34 bib template.

**Base:** `main` @ `a9e6928f` (post PR #229 v1.4.1 Phase 24)
**Workstream branch:** `gsd/v1.5-wave`
**Plan count:** 3 plans, 15 atomic tasks total

---

## Plan 21-01: Next.js scaffold + auth mirror

**Goal:** `apps/run.bib/webapp/` boots `next dev` locally, gates all pages behind auth, and the DC34 OIDC provider (`bib` client) redirects a signed-in user to `/`.

**Covers SCs:** #1 (partial — scaffold + build), #3 (login-required gate), #8 (auth pattern copied verbatim).

**Files created:** `apps/run.bib/webapp/package.json`, `next.config.js`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `.env.example`, `src/config/auth.ts`, `src/middleware.ts`, `src/app/{layout,page,providers}.tsx`, `src/app/signin/page.tsx`, `src/app/access-denied/page.tsx`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/health/route.ts`, `Dockerfile.webapp`, `VERSION`.

### Tasks

1. **21-01-01: Scaffold Next.js 16 webapp mirroring run.gpx package layout.**
   - Copy `apps/run.gpx/webapp/{package.json, next.config.js, tsconfig.json, tailwind.config.ts, postcss.config.mjs}` to `apps/run.bib/webapp/`.
   - String-swap `run.gpx` → `run.bib`, `gpx.defcon.run` → `bib.defcon.run`, port `3003` → `3004`. Keep Next.js 16 / React 19 / HeroUI / Tailwind 4 versions identical.
   - Add `.env.example` documenting: `BIB_PUBLIC_URL`, `LOCAL_BIB_PORT=3004`, `AUTH_JWT_SECRET`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `AUTH_INTERNAL_SECRET`, `RUN_ELECTRO_ID/SECRET/REGION/DBNAME`.
   - Commit: `v1.5 Phase 21: scaffold apps/run.bib/webapp package layout`

2. **21-01-02: Copy auth config verbatim; string-swap gpx → bib.**
   - Copy `apps/run.gpx/webapp/src/config/auth.ts` → `apps/run.bib/webapp/src/config/auth.ts`. Sed: `GPX_PUBLIC_URL` → `BIB_PUBLIC_URL`, `LOCAL_GPX_PORT` → `LOCAL_BIB_PORT`, `[run.gpx]` → `[run.bib]`, cookie names `_gpx` → `_bib` (4 occurrences), `gpx.${siteDomain}` → `bib.${siteDomain}`.
   - Verify against Read tool that ALL run.gpx-specific strings are updated (grep-safe: `grep -n gpx apps/run.bib/webapp/src/config/auth.ts` should return 0 matches).
   - Commit: `v1.5 Phase 21: mirror run.gpx auth config for run.bib`

3. **21-01-03: Copy middleware + signin + access-denied pages.**
   - Copy `apps/run.gpx/webapp/src/middleware.ts` → `apps/run.bib/webapp/src/middleware.ts` (string-swap `gpx` → `bib`; whitelist unchanged: `/signin`, `/access-denied`, `/api/auth/*`, `/api/health`).
   - Copy `apps/run.gpx/webapp/src/app/signin/page.tsx` + `apps/run.gpx/webapp/src/app/access-denied/page.tsx` → `apps/run.bib/webapp/src/app/{signin,access-denied}/page.tsx`. String-swap.
   - Copy `apps/run.gpx/webapp/src/app/api/auth/[...nextauth]/route.ts` verbatim (imports from `config/auth`).
   - Add `apps/run.bib/webapp/src/app/api/health/route.ts` (mirror run.flash's).
   - Commit: `v1.5 Phase 21: copy signin/access-denied/middleware/api-auth stubs`

4. **21-01-04: Scaffold app shell (layout, providers, placeholder page).**
   - Copy `apps/run.gpx/webapp/src/app/{layout.tsx, providers.tsx}` → `apps/run.bib/webapp/src/app/{layout.tsx, providers.tsx}`. Update `<title>` to "Get Your Bib · DC34".
   - Placeholder `page.tsx`: "Loading…" (Plan 21-03 replaces with real UI).
   - Add `apps/run.bib/webapp/Dockerfile.webapp` mirroring `apps/run.gpx/webapp/Dockerfile.webapp`.
   - Add `apps/run.bib/webapp/VERSION` = `0.1.0`.
   - Add `apps/run.bib/nginx/{Dockerfile.nginx, nginx.conf, VERSION}` mirroring `apps/run.flash/nginx/`.
   - Run `cd apps/run.bib/webapp && npm install --package-lock-only && npx tsc --noEmit && npx next build` — must exit 0.
   - Commit: `v1.5 Phase 21: bootstrap app shell + Dockerfile + nginx sidecar`

5. **21-01-05: Register `bib` OIDC client in run.auth (if not present from Phase 20).**
   - Check `apps/run.auth/webapp/src/config/oidc.ts` and `apps/run.auth/webapp/src/index.ts` for a `bib` client entry.
   - If absent: add `bib` client (client_id `bib`, redirect_uri `https://bib.defcon.run/${region}/api/auth/callback/run.defcon.run`, scopes `openid profile email services`, client_secret_post auth).
   - Commit: `v1.5 Phase 21: register bib OIDC client in run.auth`
   - If already present: `git commit --allow-empty -m "v1.5 Phase 21: bib OIDC client already registered — no change"`

**Gate:** SC #1 (partial), #3, #8. `next build` clean; middleware gates all non-whitelist routes; `curl :3004/api/health` returns 200; `curl :3004/` redirects to `/signin`.

---

## Plan 21-02: Bib + BibReconcile entities + API routes

**Goal:** `Bib` and `BibReconcile` ElectroDB entities live on the shared `run-human-electro` table. `GET /api/bib` (fetch own bib), `POST /api/bib` (idempotent create with generated BIB-XXXX), `PATCH /api/bib` (name edit, 409 if `nameLocked`).

**Covers SCs:** #2, #6, #7, #3 (idempotency).

**Files created:** `apps/run.bib/webapp/src/entities/client.ts`, `src/entities/bib.ts`, `src/entities/bib-reconcile.ts`, `src/lib/runner-code.ts`, `src/app/api/bib/route.ts`.

### Tasks

1. **21-02-01: Copy ElectroDB client from run.human verbatim.**
   - Copy `apps/run.human/webapp/src/entities/client.ts` → `apps/run.bib/webapp/src/entities/client.ts`. Zero swaps — same shared table, same env vars.
   - Commit: `v1.5 Phase 21: copy ElectroDB client for shared run-human-electro table`

2. **21-02-02: Define Bib entity with runnerCode-index GSI mapping.**
   - Write `apps/run.bib/webapp/src/entities/bib.ts`:
     - Entity: `service: "run"`, `entity: "Bib"`, `version: "1"`.
     - Attributes: `ownerSub` (string, required), `nameOnBib` (string, default ""), `runnerCode` (string, required, readOnly), `paidAmount` (number, default 0), `paidStatusHistory` (list of {provider, amount, timestamp, reconciled_via}, default []), `nameLocked` (boolean, default false), `createdAt`, `updatedAt`.
     - Indexes: `primary` composite on `ownerSub` (pk) + literal `"BIB"` (sk template — single-record-per-user); `byRunnerCode` on `runnerCode-index` GSI (hash_key `runnerCode`).
     - Helpers: `getBib(ownerSub)`, `createBib(ownerSub, runnerCode)` (idempotent — try create, on ConditionalCheckFailedException return existing), `updateBibName(ownerSub, nameOnBib)` (throws NameLockedError if `nameLocked=true`).
   - Commit: `v1.5 Phase 21: Bib entity with runnerCode-index GSI`

3. **21-02-03: Define BibReconcile entity + generator util.**
   - Write `apps/run.bib/webapp/src/entities/bib-reconcile.ts`:
     - Entity: `service: "run"`, `entity: "BibReconcile"`, `version: "1"`.
     - Attributes: `receiptId` (string, required), `receivedAt` (number, required), `provider` (["venmo", "cashapp"]), `extractedAmount` (number), `extractedComment` (string), `extractedSenderName` (string), `status` (["matched", "unmatched", "ambiguous"], default "unmatched"), `matchedOwnerSub` (string), `createdAt`, `updatedAt`.
     - Indexes: `primary` on `receiptId`. `byOwner` on the next available GSI (verify with human-electro table doc; if none free, mark task as blocker and log in STATE.md).
     - Helpers: `createReconcile(input)` — Phase 22 populates; Phase 21 only defines the entity + stub.
   - Write `apps/run.bib/webapp/src/lib/runner-code.ts`:
     - `generateRunnerCode()` → `"BIB-" + 4 chars from alphabet [A-HJ-NP-Z2-9]` (no 0/O/I/L/1/1).
     - `generateUniqueRunnerCode(maxAttempts=5)`: loop; query `Bib.byRunnerCode({runnerCode}).go()`; if empty, return; else retry. Throw after `maxAttempts`.
   - Commit: `v1.5 Phase 21: BibReconcile entity + runnerCode generator`

4. **21-02-04: API route /api/bib GET + POST + PATCH.**
   - Write `apps/run.bib/webapp/src/app/api/bib/route.ts`:
     - `GET`: `auth()` session → 401 no session. Return `getBib(session.user.id)` or `{}` if not created yet (with `hasCreated: false`).
     - `POST`: `auth()` session → 401 no session. `generateUniqueRunnerCode()`. Try `createBib(session.user.id, runnerCode)` — on collision return existing (idempotent per user).
     - `PATCH`: `auth()` session → 401. Body: `{nameOnBib}` (max 32 chars, trimmed). Call `updateBibName(session.user.id, nameOnBib)` — catch `NameLockedError` → 409 with `{error: "name_locked"}`. Other errors → 500.
     - Explicit `NextResponse.json` return type on all three; input validation via Zod on POST body only (empty) and PATCH body (`nameOnBib`).
   - Commit: `v1.5 Phase 21: /api/bib GET/POST/PATCH with 409 on nameLocked`

**Gate:** SC #2, #6, #7. Entities compile via `tsc --noEmit`. Manual smoke test against a local DDB (env `RUN_ELECTRO_ENDPOINT` pointing at `apps/local/dynamodb` if available; otherwise sandbox-verify via unit test of `generateRunnerCode` shape).

---

## Plan 21-03: Bib preview UI + BIB-XXXX rendering

**Goal:** Landing page hosts a live-preview bib SVG. User types name; preview updates. Empty name → shows `1337`. Non-empty → shows name auto-shrunk to fit ≤ 32 chars. `runnerCode` is displayed to the user (BIB-XXXX badge). First page load POSTs `/api/bib` if user has no bib.

**Covers SCs:** #4, #5, #6 (user-visible).

**Files created:** `apps/run.bib/webapp/src/components/{BibPreview,BibForm}.tsx`. Files modified: `apps/run.bib/webapp/src/app/page.tsx`.

### Tasks

1. **21-03-01: BibPreview SVG component.**
   - Write `apps/run.bib/webapp/src/components/BibPreview.tsx`:
     - Props: `{name: string, code: string}`.
     - Renders SVG (viewBox `0 0 800 400`): outer border, DC34 branding placeholder (title "DC34 · RUN.DEFCON.RUN"), centred primary display area, `runnerCode` small badge in a corner.
     - Primary area: `<text>` — content is `name || "1337"`. Font-size logic: base 200px; if `name.length > 8`, size = `Math.floor(1600 / name.length)` capped at 200, floored at 60.
     - Truncate/prevent overflow with `textLength` + `lengthAdjust="spacingAndGlyphs"` OR max chars = 32.
   - No React state; pure presentational.
   - Commit: `v1.5 Phase 21: BibPreview SVG with 1337 placeholder + auto-shrink`

2. **21-03-02: BibForm controlled input + submit wire-up.**
   - Write `apps/run.bib/webapp/src/components/BibForm.tsx`:
     - Client component. Props: `{initialName: string, initialCode: string, nameLocked: boolean}`.
     - HeroUI `Input` (controlled) for `nameOnBib` — `maxLength=32`, `disabled={nameLocked}`.
     - Live preview: `<BibPreview name={inputValue} code={initialCode} />`.
     - Debounced (400ms) PATCH to `/api/bib` on change; disabled state during in-flight PATCH; toast on 409 `name_locked`.
   - Commit: `v1.5 Phase 21: BibForm controlled input with debounced PATCH`

3. **21-03-03: Landing page wires GET → conditional POST → BibForm.**
   - Rewrite `apps/run.bib/webapp/src/app/page.tsx`:
     - Server component. `auth()` — if no session, middleware handled it (won't reach here).
     - Server-side `fetch(/api/bib)` — pass cookies. If `hasCreated: false`, server-side `fetch(/api/bib, {method: "POST"})` → get bib.
     - Render `<h1>Get Your Bib</h1>` + `<BibForm initialName={bib.nameOnBib} initialCode={bib.runnerCode} nameLocked={bib.nameLocked} />`.
     - Include small "Your Runner Code: **BIB-XXXX**" badge above the form.
   - Commit: `v1.5 Phase 21: landing page — GET bib, POST if absent, render BibForm+BibPreview`

4. **21-03-04: Verify next build + tsc, add TESTS placeholder.**
   - `cd apps/run.bib/webapp && npm install && npx tsc --noEmit && npx next build` — must exit 0.
   - Add `apps/run.bib/webapp/src/__tests__/runner-code.test.ts` — 3 unit tests: format `BIB-XXXX`, alphabet excludes ambiguous chars, `generateUniqueRunnerCode` retries on collision.
   - Commit: `v1.5 Phase 21: next build clean + runner-code unit tests`

**Gate:** SC #4, #5, #6. `next build` clean. Local `next dev` (sandbox-verify at `curl :3004/` returns 200 after mock auth) renders the SVG preview with `1337` on empty name, name-content on non-empty. `runnerCode` badge displays.

---

## Wave / dependency ordering

- Plan 21-01 must complete before 21-02 (auth needed for API routes to call `auth()`).
- Plan 21-02 must complete before 21-03 (UI depends on API + entity).
- Sequential: 21-01 → 21-02 → 21-03. No parallel waves possible without breaking API surface contract.

## Goal-backward SC check

| SC | Covered by |
|---|---|
| 1. Next.js scaffold builds | 21-01-01, 21-01-04 (`next build` gate) |
| 2. Bib + BibReconcile entities | 21-02-02, 21-02-03 |
| 3. Login required + idempotent create | 21-01-02, 21-01-03, 21-02-04 |
| 4. Registration UI + live preview | 21-03-01, 21-03-02, 21-03-03 |
| 5. 1337 placeholder + auto-shrink | 21-03-01 |
| 6. runnerCode generated + immutable | 21-02-03 (util), 21-02-04 (POST), 21-03-03 (badge) |
| 7. API routes GET/POST/PATCH with nameLocked 409 | 21-02-04 |
| 8. Auth pattern copied from run.gpx | 21-01-02, 21-01-03, 21-01-05 |

Every SC has an owning task. No SC unaccounted for.

## Blockers to watch

- **run.auth OIDC client `bib`** — Plan 21-01-05 checks; if not landed, that task registers it as part of Phase 21. If it's not code the executor can safely add (e.g., needs Kurt manual), flag as Blocker in STATE.md and note in Slack.
- **BibReconcile secondary GSI** — Plan 21-02-03: verify a free GSI exists on `run-human-electro` before wiring `byOwner`. If not, ship Phase 21 without the `byOwner` index (Phase 22's Lambda queries by primary key from receiptId lookup — still functional).
- **DC34 bib SVG asset** — Plan 21-03-01 uses a minimal placeholder if Kurt hasn't handed off the artwork. Flag in Blockers if merged before the asset lands.
- **Local DDB smoke test** — sandbox may not have `apps/local/dynamodb` running; unit test alone covers Phase 21 close; full integration deferred to Phase 23 deploy-verify.
