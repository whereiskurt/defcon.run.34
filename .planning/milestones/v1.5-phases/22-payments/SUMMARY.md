# Phase 22 Execution Summary

**Branch:** `gsd/v1.5-wave-22-03` (Plan 22-03 only — other plans on separate branches)
**Base:** `origin/main @ 1a37ca4a` (Phase 22 planning PR #239 merged)

## Plan 22-03 — SES → Haiku Lambda infrastructure

**Executed:** 2026-07-02
**Result:** 4/4 tasks complete; local gates pass; terragrunt gate deferred to HITL

### Commits

| Task | Hash | Subject |
|------|------|---------|
| 22-03-1 | `4b40aa34` | reconcile Lambda scaffold (Node.js 22) |
| 22-03-2 | `dc259a3d` | bib-reconcile-lambda Terragrunt module (IAM + S3 trigger) |
| 22-03-3 | `a43cf791` | run.bib reconcile lambda live terragrunt unit |
| 22-03-4 | `6e7af249` | BudgetCounter entity for $20/day cap |

### Gates

- `apps/run.bib/lambda/reconcile/`: `npm install` (150 pkg / 0 vuln), `npm ci --omit=dev` (21 pkg), vitest 6/6, module import resolves
- `apps/run.bib/webapp/`: `tsc --noEmit` exit 0, `next build` 7 pages, vitest 18/18 (12 new BudgetCounter + 6 existing runner-code)
- `infra/`: terragrunt/terraform binaries not available in sandbox — static syntax balance verified; `plan --non-interactive` deferred to HITL

### Deviations (all in commit bodies)

1. **[Rule 3]** Terragrunt live-unit path moved from `services/run.bib/lambdas/reconcile/` to `region/us-east-1/bib-reconcile/` — plan path outside `region.hcl` parent chain so `find_in_parent_folders("region.hcl")` couldn't resolve `region.label`. All existing regional units live under `region/us-east-1/`.
2. **[Rule 2]** `reserved_concurrent_executions = 5` — spam-forward burst can't blow the $20/day Haiku cap before the DDB counter commits.
3. **[Rule 2]** IAM `SES:SendEmail` bounded by `ses:FromAddress` + `ForAllValues:StringEquals ses:Recipients` conditions to prevent outbound-spam abuse.
4. **[Rule 2]** KMS `Decrypt` gated by `kms:EncryptionContext:PARAMETER_ARN` so the role decrypts ONLY the Anthropic API key, not any other SecureString under the same alias.
5. **[Rule 3]** Anthropic SDK pinned at `^0.24.3` (PATTERNS.md wrote `^0.24.x`).

### Outstanding HITL items

1. **Terragrunt plan/apply** against real AWS — Kurt's workstation runs `terragrunt validate` + `terragrunt plan --non-interactive` in `infra/terraform/live/site/region/us-east-1/bib-reconcile/`
2. **`npm ci --omit=dev` in the Lambda source** before Terragrunt plan/apply — caller runs it inside `apps/run.bib/lambda/reconcile/` so `node_modules/` is present in the zipped archive
3. **Reserved concurrency = 5** — if realistic Venmo/CashApp forwarding volume trips throttling, bump via `extra_environment` or open a v1.1.0 module

### Blockers for downstream plans

- **Plan 22-01** (Stripe): SSM `stripe/secret_key` needed — Kurt has the pre-filled commands
- **Plan 22-02** (Venmo/CashApp pages): depends on 22-01 SponsorForm; SSM handles overridable
- **Plan 22-04** (Haiku extraction + matcher): scaffolds ready from this plan; needs `checkBudget()` + `incrementBudget()` wired from BudgetCounter entity; Kurt loaded Anthropic key so real API sanity-check works

### Phase 22 progress (after Plan 22-03)

1/4 plans complete. Plans 22-01, 22-02, 22-04 to follow.

---

## Plan 22-04 — Reconciliation Lambda handler (Node.js + Anthropic SDK)

**Branch:** `gsd/v1.5-wave-22-04`
**Base:** `origin/main @ 90fef12b` (Plan 22-03 merged as PR #240)
**Executed:** 2026-07-02
**Result:** 4/4 tasks complete; local gates pass; live-Anthropic + real Stripe + real receipt E2E deferred to HITL

### Commits

| Task | Hash | Subject |
|------|------|---------|
| 22-04-1 | `ed03e092` | Haiku extraction with forced tool use |
| 22-04-2 | `ba9d44eb` | reconciliation matching (runnerCode primary + name fallback) |
| 22-04-3 | `6a2bf9f8` | $20/day budget cap + admin notification + canPrintName helper |
| 22-04-4 | (this commit) | Phase 22 close gate — SSM paths only, no key literals |

### Gates

- `apps/run.bib/lambda/reconcile/`: vitest **54/54** (+1 INTEGRATION skipped) — mailparser fixtures round-trip; Anthropic client dependency-injected for shape assertions on prompt / tool_choice; matcher + reconcile orchestrator + budget cap + notification all covered end-to-end via injected deps.
- `apps/run.bib/webapp/`: vitest **26/26** (18 existing + 8 new `canPrintName`) — PRINT_PAID_MIN_CENTS=1000 pinned; both-conditions gating verified at threshold + boundary + null-guard.
- Grep guards clean: `grep -r "sk_live_" apps/` = 0 hits; `grep -r "sk-ant-" apps/` = 0 hits. All SSM paths (`stripe/secret_key`, `anthropic/api_key`) live only under `infra/terraform/`.

### SC coverage matrix (Phase 22 close-out)

| SC | Delivered by | Notes |
|----|--------------|-------|
| SC1 Sponsor CTA + slider | 22-01-02 (parallel branch) | Verified via that agent's SUMMARY |
| SC2 Stripe Checkout + webhook | 22-01-03, 22-01-04 (parallel) | Live-mode HITL |
| SC3 Venmo instructions | 22-02-01, 22-02-03 (parallel) | Handles read from SSM env |
| SC4 CashApp instructions | 22-02-02, 22-02-03 (parallel) | Handles read from SSM env |
| SC5 SES → Lambda → Haiku → BibReconcile | **22-03 infra + 22-04-1 extractor + 22-04-2 matcher** | Full pipeline wired |
| SC6 Match by runnerCode + fallback | **22-04-2** | Primary regex + name-fuzzy fallback; both under test |
| SC7 Unmatched → notification | **22-04-3** | SES SendEmail bounded by IAM to `defcon.run@gmail.com` |
| SC8 canPrintName gate | **22-04-3** | `paidAmount >= 1000 && nameLocked` in `Bib` entity + tests |

### Plan 22-04 deviations (all in commit bodies)

1. **[Rule 3]** Chose electrodb (already installed) over raw DDB SDK for `lib/entities.mjs` — mirrors webapp entity PK/SK format verbatim; safer than hand-encoding electrodb's `$run#bib_1#...` composite-key layout. Plan text said "reimplement a minimal DDB-SDK version"; the semantic contract stays identical (dedup on receiptId via `.create()` conditional; atomic `.add().append()` for Bib mutation).
2. **[Rule 2]** BibReconcile ledger row written FIRST via `.create()` (conditional-on-nonexistence). If it already exists, `alreadyProcessed=true` returns early WITHOUT re-mutating Bib — critical for at-least-once S3 event delivery + SDK-level 429/5xx retries.
3. **[Rule 2]** Budget cap increment happens AFTER Haiku call (not before) — a failed extractor invocation does NOT burn cap headroom. Also uses `>=` not `>` so at exactly 2000¢ the next call short-circuits.
4. **[Rule 2]** Name-fuzzy matcher requires normalized length ≥ 3 chars AND single unique candidate — avoids ambiguous "Al" matching everyone with "Alex" / "Alan" / etc. Multiple candidates → unmatched (safer to escalate than mis-apply payment).
5. **[Rule 2]** `sender_display_name` fuzzy check contains-either-way (bib.contains(sender) || sender.contains(bib)) — handles both "Charlie" bib matching "Charlie Brown" sender AND "Alice" sender matching "Alice Johnson" bib.
6. **[Rule 3]** INTEGRATION=1 opt-in gate for live-Haiku test — costs ~$0.001/run, but keeps unattended CI free of Anthropic spend. Kurt's `sk-ant-*` SSM key can flip the gate on for a real E2E sanity check.

### Concurrency deviation — worktree collision with parallel Plan 22-01 agent

**[Environmental — not a Rule violation]** During execution, a parallel Claude agent running Plan 22-01 in the SAME `-v15` worktree race-hijacked shared branch refs. Every ~30 seconds the parallel agent forced `HEAD` back to `gsd/v1.5-wave-22-01`, silently reverting mid-flight edits to `index.mjs` + deleting untracked Task 22-04-02 files. My Task 22-04-01 commit `ed03e092` survived on `gsd/v1.5-wave-22-04` throughout.

**Recovery:** Created an isolated `git worktree add` at `$SCRATCH/task-22-04-worktree` (outside `/home/sandbox/work/`, so the parallel agent's `git checkout` operations couldn't reach it). Symlinked `node_modules/` in for `npx vitest`. All Tasks 22-04-02/03/04 committed in the isolated worktree; branch `gsd/v1.5-wave-22-04` force-updated to my commits after each Task.

**Root cause suggestion for Kurt:** two autonomous agents claiming the same worktree directory need distinct isolation. Consider either separate `git worktree add` per parallel-plan agent OR a synchronization lock on the shared HEAD.

### Outstanding HITL items (Plan 22-04)

1. **Live Anthropic Haiku E2E** — flip `INTEGRATION=1 vitest run` on Kurt's workstation with the real `sk-ant-*` key; verify the venmo fixture round-trips.
2. **Real Venmo/CashApp receipt shape refinement** — public research in AI-SPEC.md is best-effort. When actual receipts hit `bibpayment@run.defcon.run`, iterate on `prompt.js` if extraction quality drops below high-confidence on >20% of real receipts.
3. **run.auth redeploy** — the bib OIDC client (registered in Plan 21-01-05) needs run.auth redeployed to serve BIB sponsors. Same blocker still on STATE.md from Phase 21.
4. **Live Stripe (`sk_live_*`) + real payment E2E** — HITL for Kurt post-merge (still blockered from Plan 22-01).

### Phase 22 progress (final)

**4/4 plans complete** in the run.bib workstream:
- Plan 22-01 (Stripe path) — parallel branch `gsd/v1.5-wave-22-01` at 04457fef (SC1, SC2, SC6 sync path)
- Plan 22-02 (Venmo/CashApp pages) — parallel branch (SC3, SC4)
- Plan 22-03 (Lambda infra) — merged as PR #240 (SC5 infra)
- Plan 22-04 (Lambda handler) — this branch `gsd/v1.5-wave-22-04` (SC5 code, SC6 async, SC7, SC8)

**Blockers remaining on STATE.md (routed for Kurt HITL):**
- Live Stripe live-mode E2E (SC2 hardware-adjacent)
- Real Venmo/CashApp receipt E2E (SC5-8 hardware-adjacent)
- run.auth redeploy for bib OIDC client

---

## Plan 22-05 — Rescope bundle (Kurt 2026-07-02 design shift)

**Branch:** `worktree-agent-a35e35be9a6605bc3` (isolated worktree for this session)
**Base:** `origin/main @ 36735c21` (Plans 22-01, 22-02, 22-03, 22-04 all merged)
**Executed:** 2026-07-02
**Result:** 7/7 tasks complete; local gates pass; SSM allowlist + run.auth redeploy + live Stripe/receipt E2E stay HITL

### Commits

| Task | Hash | Subject |
|------|------|---------|
| 22-05-01 | `0265fe4a` | willPayInPerson field + free bib print gate |
| 22-05-02 | `f6cf4faa` | GeneralDonation entity + repository helpers |
| 22-05-03 | `e18f5038` | two-product Stripe checkout + webhook donation_type branch |
| 22-05-04 | `78220760` | landing page 3-section restructure + willPayInPerson checkbox |
| 22-05-05 | `1c472aa9` | naming sweep DEF CON → defcon.run (visible copy only) |
| 22-05-06 | `af5229f6` | sponsor charm accent on BibPreview |
| 22-05-07 | `14107dd6` | admin gate + pledged-unpaid report route |

### Gates (final)

- `apps/run.bib/webapp/`: `tsc --noEmit` exit 0; `vitest run` **98/98** (10 files); `next build` clean at **10 routes** (up from 7 pre-22-05: renamed `/api/checkout` → `/api/checkout/bib`, added `/api/checkout/general` and `/api/admin/bib/pledged-unpaid`).
- Grep guard: `grep -rn "DEF CON" apps/run.bib/webapp/src/` returns exactly 2 hits — the smiley graphic comment in BibPreview.tsx (protected) + the Phase 22-05-05 rename docblock in config/auth.ts (intentional).
- Route count final: `/`, `/access-denied`, `/api/admin/bib/pledged-unpaid`, `/api/auth/[...nextauth]`, `/api/bib`, `/api/checkout/bib`, `/api/checkout/general`, `/api/health`, `/api/stripe/webhook`, `/signin` + `/_not-found`.

### Rescope items delivered

| Kurt's 2026-07-02 item | Task | Notes |
|-------------------------|------|-------|
| 1. `willPayInPerson` field + PATCH | 22-05-01 | Bib entity + Zod schema + updateBibWillPayInPerson helper |
| 2. Print gate → `nameLocked` alone | 22-05-01 | `canPrintName()` simplified; `PRINT_PAID_MIN_CENTS` removed |
| 3. `GeneralDonation` entity | 22-05-02 | Nullable ownerSub + idempotent recordDonation via `stripe:` prefixed donationId |
| 4. Two-product Stripe + donation_type branch | 22-05-03 | `/api/checkout/{bib,general}` split + webhook branch on `metadata.donation_type` |
| 5. 3-section landing page | 22-05-04 | Get bib (free) / Sponsor bib / Just donate + WillPayInPersonCheckbox component |
| 6. Naming sweep DEF CON → defcon.run | 22-05-05 | grep-driven; graphic smiley + code identifiers preserved |
| 7. Sponsor charm on BibPreview | 22-05-06 | `hasSponsored` prop; wired from `bib.paidAmount > 0` |
| 8. Admin report route | 22-05-07 | Option A (SSM allowlist at `/dc34/secrets/use1/bib/admin/allowlist`); `requireAdmin` fail-closed |

### Design decisions locked at execution

1. **Admin gate = Option A (SSM allowlist)** — no run.auth PR needed; simpler bootstrap. Fail-closed on empty/misconfigured allowlist so a bad SSM state rejects everyone rather than opens the endpoint.
2. **General donation session-required** — MVP requires auth session for auditability. Anonymous flow deferred to v1.6 (PLAN-22-05.md design gap #1).
3. **General donation Stripe-only for MVP** — Venmo/CashApp `general` donations would hit the Haiku matcher's `unmatched` path (no runnerCode + no sender-in-bibs). Deferred to v1.6 (PLAN-22-05.md design gap #2).
4. **Sponsor charm = amber circle + white star** — geometric default per PLAN-22-05.md design gap #4. Kurt can swap to a bespoke glyph in Phase 23 deploy inspection.
5. **BibForm accepts `hasSponsored` as an optional prop** — backward compat for any pre-22-05 caller. Defaults to `false`.

### Deviations (all in commit bodies)

1. **[Rule 2 - Security]** Admin allowlist FAILS CLOSED on any SSM error or empty payload. An empty allowlist denies everyone instead of admitting anyone / defaulting to Kurt's sub. Prevents a misconfig from silently opening the admin surface.
2. **[Rule 2 - Correctness]** GeneralDonation `recordDonation()` catches `ConditionalCheckFailedException` on `.create()` and returns the existing row rather than throwing. Mirrors Bib.applyPayment's idempotency semantics for Stripe webhook retries.
3. **[Rule 2 - Correctness]** GeneralDonation payload construction omits `ownerSub` / `stripeSessionId` keys entirely when the caller passes null/undefined — ElectroDB rejects literal `undefined` writes. Tests explicitly cover the null-ownerSub payload elision.
4. **[Rule 3 - Blocking issue]** Stale `.next/types/validator.ts` reference to the pre-rename `/api/checkout/route.js` was breaking `tsc --noEmit` between Task 3 file-move and next build. Cleared `.next/` cache. Regenerated cleanly on next build.
5. **[Rule 3 - Minor]** `SponsorForm` submit button label defaults to "Sponsor" for variant='bib' and "Donate" for variant='general' — plan text only specified the ctaLabel prop; the default made the two sections render distinct CTAs without page.tsx having to pass both.
6. **[Rule 2 - Naming]** Product name in `/api/checkout/bib` was pre-emptively updated from "DEF CON 34 Run" to "defcon.run 34" in Task 22-05-03 rather than waiting for Task 22-05-05. Metadata is visible in Stripe's dashboard + on the customer's receipt.
7. **[Rule 3 - Test fidelity]** Reconcile Lambda test fixtures (`venmo-01.eml`, `cashapp-01.eml`, `extract.test.mjs`) were NOT swept. These emulate REAL user-typed comments in Venmo/CashApp receipts — real DEF CON attendees today would type "DEF CON" or "DEF CON Run 34" in their memo lines, not "defcon.run". Changing the fixtures would misrepresent test fidelity for the Haiku matcher.

### Files created / modified

**New (webapp):**
- `apps/run.bib/webapp/src/entities/general-donation.ts` (Task 2)
- `apps/run.bib/webapp/src/app/api/checkout/general/route.ts` (Task 3)
- `apps/run.bib/webapp/src/components/WillPayInPersonCheckbox.tsx` (Task 4)
- `apps/run.bib/webapp/src/lib/admin-gate.ts` (Task 7)
- `apps/run.bib/webapp/src/app/api/admin/bib/pledged-unpaid/route.ts` (Task 7)

**New tests:**
- `apps/run.bib/webapp/src/__tests__/will-pay-in-person.test.ts` (Task 1, 4 assertions)
- `apps/run.bib/webapp/src/__tests__/general-donation.test.ts` (Task 2, 12 assertions)
- `apps/run.bib/webapp/src/__tests__/bib-preview.test.tsx` (Task 6, 5 assertions)
- `apps/run.bib/webapp/src/__tests__/admin-gate.test.ts` (Task 7, 18 assertions)

**Renamed:**
- `apps/run.bib/webapp/src/app/api/checkout/route.ts` → `apps/run.bib/webapp/src/app/api/checkout/bib/route.ts` (Task 3, via `git mv`)

**Modified:**
- `apps/run.bib/webapp/src/entities/bib.ts` (Tasks 1, 5): +willPayInPerson +updateBibWillPayInPerson; canPrintName rewritten; PRINT_PAID_MIN_CENTS removed.
- `apps/run.bib/webapp/src/app/api/bib/route.ts` (Task 1): PATCH schema accepts optional nameOnBib + willPayInPerson with at-least-one refine.
- `apps/run.bib/webapp/src/app/api/stripe/webhook/route.ts` (Task 3): donation_type branch handlers.
- `apps/run.bib/webapp/src/components/SponsorForm.tsx` (Tasks 3, 4): variant prop + checkoutEndpointFor helper.
- `apps/run.bib/webapp/src/components/BibForm.tsx` (Task 6): threads hasSponsored to BibPreview.
- `apps/run.bib/webapp/src/components/BibPreview.tsx` (Task 6): hasSponsored prop + sponsor charm SVG group.
- `apps/run.bib/webapp/src/app/page.tsx` (Tasks 4, 5, 6): 3-section restructure + Section wrapper + charm wiring + copy naming sweep.
- `apps/run.bib/webapp/src/app/layout.tsx` (Task 5): HTML title/meta naming sweep.
- `apps/run.bib/webapp/src/app/signin/page.tsx`, `apps/run.bib/webapp/src/app/access-denied/page.tsx` (Task 5): visible copy naming sweep.
- `apps/run.bib/webapp/src/config/auth.ts` (Task 5): OIDC provider display name naming sweep.
- Updated existing tests: `can-print-name.test.ts` (Task 1), `stripe-webhook.test.ts` (Task 3, +7 new donation_type assertions), `sponsor-form.test.ts` (Task 4, +3 new endpoint-router assertions).

### Outstanding HITL items (Plan 22-05)

1. **SSM param creation** — Kurt to create `/dc34/secrets/use1/bib/admin/allowlist` as a SecureString containing the comma-separated OIDC `sub` values for Kurt + Jesse (plus anyone else who needs admin access before Phase 23 deploy).
2. **Live end-to-end verification of the two-product Stripe path** — Stripe test mode via `stripe listen` + `stripe trigger checkout.session.completed` for both donation_type=bib and donation_type=general fixtures. HITL because the sandbox can't run the Stripe CLI against real webhook endpoints.
3. **Deploy inspection of sponsor charm visual** — Kurt to decide if the geometric amber+star default is acceptable or if a bespoke defcon.run wordmark badge is preferred (PLAN-22-05.md design gap #4).
4. **run.auth redeploy** — still blockered from Phase 21; the bib OIDC client + new `defcon.run` provider name won't render on the real sign-in page until run.auth is redeployed.
5. **v1.6 backlog carry-over** — anonymous /api/checkout/general flow (design gap #1); Venmo/CashApp general-donation matcher fallback (design gap #2); byWillPayInPerson GSI if pledged-unpaid scan latency becomes a problem.

### Phase 22 progress (after Plan 22-05)

**5/5 plans complete** in the run.bib workstream:
- Plan 22-01 (Stripe path) — merged as PR #244 (SC1, SC2, SC6 sync path)
- Plan 22-02 (Venmo/CashApp pages) — parallel branch (SC3, SC4)
- Plan 22-03 (Lambda infra) — merged as PR #240 (SC5 infra)
- Plan 22-04 (Lambda handler) — merged as PR #247 (SC5 code, SC6 async, SC7, SC8)
- Plan 22-05 (rescope bundle) — this branch (free bib + 2-product checkout + naming sweep + admin gate)

**Phase 22 code-side: COMPLETE.** All local gates green across the webapp + lambda. All hardware/HITL blockers documented above route to STATE.md for Kurt.

