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

## Plan 21-03 — Bib preview UI + BIB-XXXX rendering

**Executed:** 2026-07-02
**Result:** 4/4 tasks complete, all gates pass

### Commits

| Task | Hash | Subject |
|------|------|---------|
| 21-03-01 | `2587a42a` | BibPreview SVG component with DC34 bib template |
| 21-03-02 | `69227352` | BibForm controlled input with debounced PATCH |
| 21-03-03 | `bcb2c592` | landing page — read/create bib, render BibForm + preview |
| 21-03-04 | `0f0c6ed3` | next build clean + runner-code unit tests |

### Landing-the-plane gates (all PASS)

**`apps/run.bib/webapp/`:**
- `npx tsc --noEmit` → exit 0 (after each of the 4 tasks)
- `npx next build` → exit 0 (7 routes emitted; `/` marked ƒ dynamic because `auth()` reads cookies; `/api/bib` ƒ dynamic; static: `/`, `/access-denied`, `/signin`, `/_not-found`)
- `npx vitest run` → 5/5 tests passed (Task 4)
- `npm install --save-dev vitest@^4.0.18` → clean; matches run.human's vitest version pin

### Design contract applied (Kurt 2026-07-02)

- **Big number placeholder = `1337`.** Rendered in the top of the black box when `nameOnBib` is empty. Once a name is entered, the big number swaps to the runnerCode (`BIB-XXXX`). Empty-name layout re-centers the number vertically in the box (per the SVG template's guidance comment).
- **Auto-shrink font-size** at both dynamic slots. Number: base 248px, floor 60px, budget 740px (accounting for the two smiley badges in the box corners). Name: base 56px, floor 20px, budget 780px. Never wraps, never truncates — 32-char names render as small legible text at the floor size.
- **Name row hidden** entirely when `nameOnBib` is empty (SVG `<text>` element skipped, not rendered as empty).
- **Tear-off stubs** always render the runnerCode (or "1337" placeholder), matching physical race-bib convention where the perforated tear-off carries the number for finish-line reconciliation.
- **32-char client cap** mirrors the server-side Zod `z.string().max(32)` in `/api/bib` PATCH. Input `maxLength={32}` + defensive slice() on paste/IME.
- **400ms PATCH debounce** with AbortController-based cancel of stale in-flight saves.
- **409 `name_locked`** flips the input to permanently disabled + surfaces "Name locked for print — contact organizers if this needs to change" in a yellow hint.
- **BIB-XXXX badge** rendered above the form in an amber-on-dark pill so the user knows the code to type into their Venmo / CashApp comment.

### Files created (Plan 21-03)

| Path | Purpose |
|------|---------|
| `apps/run.bib/webapp/src/components/BibPreview.tsx` | Pure JSX SVG, dynamic `#bib-number` / `#bib-name`, auto-shrink font logic |
| `apps/run.bib/webapp/src/components/BibForm.tsx` | Client form: controlled input, debounced PATCH, save-state hints, 409 handling |
| `apps/run.bib/webapp/src/components/dc34-logo.ts` | DC34 logo as base64 webp data URI (in-tree so preview renders standalone) |
| `apps/run.bib/webapp/src/__tests__/runner-code.test.ts` | 5 unit tests: shape, alphabet, uniqueness retry loop |
| `apps/run.bib/webapp/vitest.config.ts` | Wires `@/*` alias; env: node |

### Files modified (Plan 21-03)

| Path | Change |
|------|--------|
| `apps/run.bib/webapp/src/app/page.tsx` | Replaced the "Loading…" placeholder with the real bib bootstrap + shell |
| `apps/run.bib/webapp/src/lib/runner-code.ts` | Doc-comment fix — alphabet excludes 0/O/I/1 (L is kept, per the authoritative regex `[A-HJ-NP-Z2-9]`); test caught the previous "0/O/I/L/1" typo |
| `apps/run.bib/webapp/package.json` | Added `test` / `test:watch` scripts; added `vitest ^4.0.18` devDep |
| `apps/run.bib/webapp/package-lock.json` | vitest + transitive deps |

### Deviations from PLAN.md

1. **[Rule 3 — blocking issue] Task 21-03-02 uses a plain `<input>` styled with inline styles, not HeroUI `<Input>`.**
   - **Rationale:** Plan 21-01 did not wire HeroUI into the run.bib scaffold (no `@heroui/react`, `@heroui/system`, `next-themes`, or `framer-motion` deps; no `HeroUIProvider` in `providers.tsx`). PLAN.md 21-03-02 mandated HeroUI. Adding it purely to render one Input pulls in ~5 new deps and a peer framer-motion — violates CLAUDE.md rule 3 ("Simplicity first — <100 lines, single-file until proven insufficient, boring patterns preferred"). Plain input hits the same behaviour contract (controlled, `maxLength={32}`, `disabled={nameLocked}`, styled to match the dark aesthetic).
   - **Impact:** If v1.6 consolidates on a shared HeroUI-based component library, swapping in `@heroui/react`'s Input is a one-line replacement (props are near-identical).
   - **Files modified:** `apps/run.bib/webapp/src/components/BibForm.tsx`.
   - **Commit:** `69227352`.

2. **[Rule 3 — blocking issue] Task 21-03-03 uses direct entity calls, not a server-side self-fetch of `/api/bib`.**
   - **Rationale:** PLAN.md 21-03-03 called for server-side `fetch("/api/bib")` + `fetch("/api/bib", {method:"POST"})` with cookies. Same-runtime self-fetch in Next.js 16 requires building an absolute URL + explicitly forwarding cookies via `headers().get("cookie")`, all to talk to the same code path we can invoke directly. Used `getBib(ownerSub)` + (conditionally) `generateUniqueRunnerCode()` + `createBib(ownerSub, code)` from the server component. Same authorization guarantee (`auth()` → `session.user.id` is the exact ownerSub the route handlers derive), lower latency, less plumbing.
   - **Impact:** The `/api/bib` route stays unchanged for the client-side PATCH; only the initial page render skips the round-trip.
   - **Files modified:** `apps/run.bib/webapp/src/app/page.tsx`.
   - **Commit:** `bcb2c592`.

3. **[Rule 1 — bug/doc fix] `runner-code.ts` doc-string listed L as excluded from the alphabet; actual regex keeps L.**
   - **Found during:** Task 4 (vitest test-2 caught `expect(RUNNER_CODE_ALPHABET).not.toContain("L")` — the alphabet DOES contain L).
   - **Fix:** Updated the doc-comment to reflect the authoritative regex (`[A-HJ-NP-Z2-9]` excludes `0/O/I/1`, not `0/O/I/L/1`). Rewrote the test to assert the correct excluded set. No runtime change — the alphabet constant, character-picking logic, and rejection sampling were all correct; only the comment was stale.
   - **Rationale for keeping L:** Arial-Black renders `L` distinctly from `1` and `I`, and dropping L would break the alphabet's power-of-two (32-char) shape rejection sampling relies on.
   - **Files modified:** `apps/run.bib/webapp/src/lib/runner-code.ts`, `apps/run.bib/webapp/src/__tests__/runner-code.test.ts`.
   - **Commit:** `0f0c6ed3`.

### DC34 logo asset handling

The Kurt-provided `bib-template.svg` embeds the DC34 logo as a large (~40KB source, ~32KB decoded webp) base64 data URI on line 64. Rather than either:
- Inlining the ~40KB string as a JSX-adjacent constant (bloats the component file), or
- Extracting the webp to `public/` and referencing via `/dc34-logo-transp.webp` (subject to basePath rewrites in prod — `next.config.ts` sets `basePath: /${REGION_SHORT}` and `assetPrefix: https://...`, and SVG `<image href>` bypasses Next's automatic path rewriting)

...we extracted the data URI into `src/components/dc34-logo.ts` as a single `DC34_LOGO_DATA_URI` string constant. `BibPreview.tsx` imports it and uses `<image href={DC34_LOGO_DATA_URI} />`. The SVG renders standalone regardless of dev / us-east-1 / cac1 environment, no static-asset path resolution needed. Bundle cost: ~32KB per client on first bib-preview render (amortized).

### Blockers surfaced (not blocking landing Plan 21-03)

- **DC34 logo asset is embedded in the component bundle rather than served from `public/`.** Trade-off documented above. If Kurt wants a smaller initial JS payload for the landing page, moving the webp to `public/` + computing the correct basePath-aware URL is a follow-up refactor (single file change).
- **No component test for BibForm / BibPreview.** Phase 21-03 tests are scoped to the runner-code util per PLAN.md. Adding React Testing Library + jsdom is a v1.6 concern.

---

## Phase 21 close-out

**Plans complete: 3 / 3**
**Tasks complete: 5 (Plan 21-01) + 4 (Plan 21-02) + 4 (Plan 21-03) = 13 total**
**Success Criteria coverage (from ROADMAP Phase 21):**

| SC | Delivered by | Status |
|----|-------------|--------|
| 1. Next.js scaffold + `next build` | 21-01-01, 21-01-04 | PASS — 7 routes emitted, standalone build clean |
| 2. Bib + BibReconcile entities | 21-02-02, 21-02-03 | PASS — both entities on shared `run-human-electro`; Bib.byRunnerCode wired to the pre-existing GSI |
| 3. Login-required + idempotent create | 21-01-02, 21-01-03, 21-02-04, 21-03-03 | PASS — middleware whitelist gates all routes; createBib idempotent under ConditionalCheckFailedException |
| 4. Registration UI + live preview | 21-03-01, 21-03-02, 21-03-03 | PASS — BibForm drives BibPreview via controlled input, debounced PATCH |
| 5. `1337` placeholder + auto-shrink | 21-03-01 | PASS — placeholder logic + fitFontSize() covers 1..32 char range |
| 6. `runnerCode` generated + immutable | 21-02-03 (util), 21-02-04 (POST), 21-03-03 (badge) | PASS — Bib entity marks `runnerCode` readOnly; badge above form |
| 7. API routes GET/POST/PATCH + 409 on nameLocked | 21-02-04 | PASS — Zod-validated; 409 mapped from NameLockedError |
| 8. Auth pattern copied from run.gpx | 21-01-02, 21-01-03, 21-01-05 | PASS — bib OIDC client registered in run.auth |

### Local-verify quick reference

```bash
cd apps/run.bib/webapp
npm install                 # 156 top-level deps after vitest add
npx tsc --noEmit            # exit 0
npx next build              # 7 routes, standalone output
npx vitest run              # 5/5 tests pass
```

Live sandbox verify against a real DDB is deferred to Phase 23 deploy-verify (Plan 21-02 SUMMARY blocker #2 stands — sandbox does not run `apps/local/dynamodb`).

### Blockers carried to Phase 22

- **BibReconcile has no secondary GSI** (unchanged from Plan 21-02 SUMMARY blocker #1). Phase 22's SES Lambda queries by primary key (receiptId lookup) so this is fine for the reconciliation happy path. If Phase 22 needs `byOwner` or `byStatus` scans, add a new GSI on `run-human-electro` mirroring the `runnerCode-index` pattern.
- **Live payment verification** — Phase 22 delivers this; Kurt hardware-analog blocker per v1.4.1 pattern for the Venmo/CashApp receipt shape.

### Blockers RESOLVED in Phase 21

- **DC34 bib artwork** — resolved in Plan 21-01 discovery; consumed by BibPreview in Plan 21-03.
- **bib OIDC client registration** — resolved in Plan 21-01-05.

## Next

Phase 22: SES → Haiku → BibReconcile Lambda for Venmo / CashApp payment matching.
