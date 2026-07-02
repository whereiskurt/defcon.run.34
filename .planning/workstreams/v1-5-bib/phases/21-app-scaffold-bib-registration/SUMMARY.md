# Phase 21 Execution Summary

**Branch:** `gsd/v1.5-wave`

---

## Plan 21-01 — Next.js scaffold + auth mirror

**Executed:** 2026-07-02
**Result:** 5/5 tasks complete, all gates pass

### Commits

| Task | Hash | Subject |
|------|------|---------|
| 21-01-01 | `677694c3` | scaffold apps/run.bib/webapp package layout |
| 21-01-02 | `927008a8` | mirror run.gpx auth config for run.bib |
| 21-01-03 | `d3b1ee6b` | copy signin/access-denied/middleware/api-auth stubs |
| 21-01-04 | `c8bf819a` | bootstrap app shell + Dockerfile + nginx sidecar |
| 21-01-05 | `d5bfd239` | register bib OIDC client in run.auth |

### Landing-the-plane gates (all PASS)

**`apps/run.bib/webapp/`:**
- `npm install --package-lock-only` → 485 packages
- `npm install` → 155 top-level
- `npx tsc --noEmit` → exit 0
- `npx next build` → 6 routes emitted; middleware compiled as Proxy

**`apps/run.auth/webapp/` (post-bib-client change):**
- `npx tsc --noEmit` → exit 0
- `npx next build` → exit 0

### Deviations from PLAN.md

1. **Middleware gates whole app, not just `/studio`** (Rule 2 — missing critical functionality). run.gpx's `middleware.ts` only guards `/studio/*`; verbatim copy would have left every route reachable without a session. Wrote a whitelist-based gate that runs on all routes (matcher excludes `_next/static`, `_next/image`, common static-asset extensions) and 302s to `/signin` with `callbackUrl` preserved.
2. **Layout mirrored from run.gpx, not run.flash** (Doc-source discrepancy). CONTEXT.md said "mirroring run.flash"; PLAN.md 21-01-04 said "Copy `apps/run.gpx/webapp/src/app/{layout.tsx, providers.tsx}`". Followed PLAN.md.
3. **`.env.example` force-added past `.gitignore`** (Rule 3 — blocking issue). PLAN.md explicitly lists it as a required deliverable; file contains only variable names + safe defaults.

### Known follow-ups (not blocking)

- Next.js 16 `"middleware" file convention is deprecated` warning — same fires in run.gpx; deferred as repo-wide migration
- `LOCAL_BIB_PORT=3004` collides with run.flash's dev port — override via env
- nginx dev cert CN was `strapi.defcon.run` (copied verbatim); `mkcerts.sh` has correct `bib.defcon.run` CN — regenerate before real deploy

---

## Plan 21-02 — Bib + BibReconcile entities + `/api/bib` routes

**Executed:** 2026-07-02
**Result:** 4/4 tasks complete, all gates pass

### Commits

| Task | Hash | Subject |
|------|------|---------|
| 21-02-01 | `8a44c839` | copy ElectroDB client for shared run-human-electro table |
| 21-02-02 | `bcee77e4` | Bib entity with runnerCode-index GSI |
| 21-02-03 | `124f3384` | BibReconcile entity + runnerCode generator |
| 21-02-04 | `0cb30c70` | /api/bib GET/POST/PATCH with 409 on nameLocked |

### Landing-the-plane gates (all PASS)

**`apps/run.bib/webapp/`:**
- `npx tsc --noEmit` → exit 0 (after each of the 4 tasks)
- `npx next build` → exit 0 (7 routes emitted after Task 4, including `/api/bib`)
- `npm install` → clean

### Design contract applied (Kurt 2026-07-02, overrides older `.planning/phases/21-.../21-CONTEXT.md`)

- **Bib** keyed by `ownerSub` (OIDC subject). SK is the fixed literal `"BIB"` → one bib per account structurally.
- Fields: `ownerSub` PK, `nameOnBib` (default ""), `runnerCode` (required, readOnly, immutable), `paidAmount` (number, cents, default 0), `paidStatusHistory` (list of `{provider, amount, timestamp, reconciled_via}`, default `[]`), `nameLocked` (bool, default false), `createdAt`, `updatedAt` (both ISO8601 strings).
- **NO size / shirt-size field** — Kurt "no sizes on bibs".
- `runnerCode` = `BIB-XXXX`, 4-char alphanumeric from unambiguous alphabet `[A-HJ-NP-Z2-9]` (32 chars → 1,048,576 possible codes). Rejection-sampled `crypto.randomBytes` for uniform distribution.
- **BibReconcile** keyed by `receiptId` (hash of email `Message-ID`). Fields per contract.
- Shared table = `run-human-electro`, service = `run` (matches RunUser/CheckIn/UserUpload).

### API contract (`apps/run.bib/webapp/src/app/api/bib/route.ts`)

- `GET /api/bib` → 401 unauth, or 200 `{hasCreated: false}` when user has no bib, or 200 `{hasCreated: true, bib}`. 200-with-flag lets the landing page (Plan 21-03) branch cleanly.
- `POST /api/bib` → 401 unauth, else idempotent. Fast path returns existing bib. Fresh create generates BIB-XXXX + inserts (createBib catches ConditionalCheckFailedException on race). 201 on true create; 200 with `created:false` on idempotent hit. Non-empty bodies rejected 400.
- `PATCH /api/bib` → 401 unauth; Zod-validates `{nameOnBib: string(max 32)}`; 400 on schema fail; 404 if no bib; 409 `{error: "name_locked"}` on `NameLockedError`; server-side trim + 32-char cap; 500 otherwise.
- All routes derive `ownerSub` from `session.user.id` (config/auth.ts populates from OIDC `sub` claim); no client-supplied owner accepted.

### Deviations from PLAN.md

1. **[Rule 3 — blocking issue] `Bib.byRunnerCode` sk field renamed from `"sk"` to `"runnerCodeSk"`.**
   - **Found during:** Task 4 (`next build` failed at route-load).
   - **Issue:** PLAN.md 21-02-02 specified the byRunnerCode index with sk composite `[]` on the shared `sk` field. Reusing the primary index's `sk` field triggers ElectroDB error 1017 `IncompatibleKeyCompositeAttributeTemplate` because the primary sk uses template `"BIB"` while byRunnerCode's sk had no template. The entity file compiled fine (`tsc --noEmit`) because the validation happens at module load — only surfaced when the route imported it into the build's runtime graph.
   - **Fix:** synthesized a distinct field `runnerCodeSk` for the GSI's sort. The underlying DynamoDB GSI (`runnerCode-index` in `infra/terraform/live/site/services/run.human/service.hcl:286-292`) is HASH-only; the synthetic field is written to the item but is not part of the actual index schema, so it costs a few bytes per row and otherwise no-ops.
   - **Files modified:** `apps/run.bib/webapp/src/entities/bib.ts`.
   - **Commit:** `0cb30c70` (Task 4 — folded in with the route so the change was tested against `next build`).

2. **[Rule 3 — blocking issue] Added `@auth/dynamodb-adapter ^2.11.1` as explicit dep of run.bib webapp.**
   - **Found during:** Task 1 (`tsc --noEmit` failed on `client.ts` import).
   - **Issue:** run.human's `client.ts` imports `@auth/dynamodb-adapter`. It was transitive in run.human's tree via a different route; run.bib's package.json didn't declare it.
   - **Fix:** added dep, `npm install`.
   - **Files modified:** `apps/run.bib/webapp/{package.json,package-lock.json}`.
   - **Commit:** `8a44c839` (Task 1).

3. **[Rule 3 — blocking issue] Added `zod ^4.4.3` as explicit dep of run.bib webapp.**
   - **Found during:** Task 4 planning (PLAN.md mandates Zod-validated bodies).
   - **Issue:** zod was transitive via electrodb; promoting to a direct dep insulates run.bib from upstream dependency changes if electrodb bumps drop it.
   - **Fix:** added dep, `npm install`.
   - **Files modified:** `apps/run.bib/webapp/{package.json,package-lock.json}`.
   - **Commit:** `0cb30c70` (Task 4).

4. **[Doc-source discrepancy] `createdAt` / `updatedAt` typed as `string` (ISO8601), not `number` epoch-ms.**
   - **Rationale:** Kurt's authoritative 2026-07-02 design contract specifies ISO8601. Old CONTEXT.md and existing CheckIn/RunUser entities use epoch-ms numbers, but the newer contract wins per the executor prompt.
   - **Impact:** Phase 22 SES Lambda must serialize timestamps as ISO strings when writing BibReconcile / patching Bib. Documented here for the Phase 22 planner.

### Blockers surfaced (not blocking landing Plan 21-02)

1. **BibReconcile has no secondary GSI** — the three electro-schema GSIs (`gsi1pk-gsi1sk-index`, `gsi2pk-gsi2sk-index`, `gsi3pk-gsi3sk-index`) are all claimed by RunUser.byHash / CheckIn.byGlobalRecent + UserUpload.byStatus / CheckIn.byUserRecent. The only extra GSI on `run-human-electro` (`runnerCode-index`) is claimed by Bib.byRunnerCode. PLAN.md 21-02-03 explicitly authorizes shipping without `byOwner` because Phase 22's Lambda queries BibReconcile by primary key (receiptId lookup). If Phase 22 or an admin UI ever needs `byOwner` or `byStatus` scans, add a new GSI at `infra/terraform/live/site/services/run.human/service.hcl` (mirror the `runnerCode-index` pattern).
2. **Bib table not yet integration-tested against real DynamoDB.** Sandbox does not run `apps/local/dynamodb`. Verification is confined to `next build` + type-check + entity-shape sanity. Phase 23 deploy-verify against AWS DynamoDB is the first end-to-end test.
3. **No unit tests for the runner-code generator yet.** Deferred to Plan 21-03-04 per PLAN.md (`apps/run.bib/webapp/src/__tests__/runner-code.test.ts` — 3 unit tests: format `BIB-XXXX`, alphabet excludes ambiguous chars, `generateUniqueRunnerCode` retries on collision).

### Known follow-ups (not blocking)

- `apps/run.bib/webapp/tsconfig.tsbuildinfo` remains tracked (inherited from 21-01 scaffold). Add a `.gitignore` in run.bib/webapp (mirroring run.gpx/webapp) as a separate Chore commit before v1.5 merge. Same pattern also present in run.gpx — repo-wide cleanup out of Phase 21 scope.
- `.next/dev/types/**` glob in tsconfig includes an incremental cache; re-run of `next build` after Task 4 emits Turbopack build artifacts. Not committed.

---

## Blockers (unchanged from 21-01)

- Live payment verification (Phase 22, hardware-in-loop-analog)
- DC34 bib artwork RESOLVED (Plan 21-01) — `.planning/phases/21-bib-app-scaffold-registration/assets/bib-template.svg` located; will be used by Plan 21-03 BibPreview

## Next

Plan 21-03: `BibPreview` SVG component, `BibForm` controlled input, landing-page wire-up (GET → conditional POST → render), and unit tests for the runner-code generator.
