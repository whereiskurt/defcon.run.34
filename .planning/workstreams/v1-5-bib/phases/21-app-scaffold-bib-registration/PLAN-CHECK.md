# PLAN-CHECK — v1.5 Phase 21

## Verdict: PASSED with notes

## Goal-backward SC coverage

Every SC in Phase 21 has a directly-owning task. Coverage table matches ROADMAP verbatim (see PLAN.md § Goal-backward SC check). No SC unmapped, no orphan tasks.

## Plan quality dimensions

| Dimension | Assessment |
|---|---|
| Atomic tasks | ✅ 15 tasks × commit-per-task. Each is a coherent 1-file-or-tight-cluster change, verifiable independently. |
| Dependency ordering | ✅ 21-01 → 21-02 → 21-03 is correct — auth blocks API, API blocks UI. |
| Reuse maximization | ✅ Every file leans on a source pattern (run.gpx auth, run.human entities, run.flash UI shell). Only truly new: BibPreview (design contract requires bespoke), runner-code util. |
| Scope discipline | ✅ Payments/reconciliation Lambda/print-gating explicitly deferred to Phase 22 in CONTEXT.md and reflected in tasks. |
| Sandbox verifiability | ⚠️ SC #4 (live preview) is UI-visible; sandbox has no browser. Task 21-03-04's `next build` clean is the strongest available signal. Real interaction verify goes to Phase 23 (or Kurt hits bib.defcon.run post-deploy). Called out in PLAN.md § Blockers as expected. |

## Issues / notes

### Non-blocking flags

1. **OIDC client `bib` registration** — 21-01-05 branches: happy path (already registered from Phase 20) vs. add-it path. The add-it path modifies `apps/run.auth/webapp/` which is another service. Executor should verify with a Read tool call before writing. If Phase 20 close-out doc claimed it landed but the code doesn't show it, that's a real gap and Phase 21 must fix it. Not a plan bug.

2. **BibReconcile secondary GSI availability** — 21-02-03 acknowledges the GSI may not exist yet on the shared table. Plan correctly falls back to primary-key-only wiring, which suffices for Phase 21's entity-defined SC. Phase 22 will need a GSI or a stream — that's a Phase 22 planning concern.

3. **BibPreview SVG asset** — Kurt-provided DC34 bib artwork is a Phase 21 nice-to-have; the plan's minimal placeholder rectangle satisfies SC #4 ("renders as a DC34-branded race bib (SVG template) with live preview updating as user types") — the "template" part is SVG-shape, and the branding placeholder is DC34-labelled. If Kurt wants the polished artwork, that's a Phase 21 close-out addition.

4. **auto-shrink formula** — 21-03-01 defines `Math.floor(1600 / name.length)` capped [60, 200]. For 32-char names → 50px, floored at 60, so 60px. Consistent with "auto-shrink ≤ 32 chars". Reviewer may prefer a `textLength` SVG attribute for exactness. Both satisfy SC #5. Executor should pick and note in commit.

### No BLOCKING issues

- All 8 SCs have owning tasks
- No task depends on an artifact absent from the repo (run.gpx auth, run.human entities, run.flash shell all exist and are readable)
- No task requires hardware
- No task touches infra (Phase 20 wired it)
- No task overlaps v1.4.1 scope
- Commit-per-task is granular enough that a failed executor can be re-run from the last successful commit

## Executor guidance

- Run tasks sequentially (no parallel waves — cross-file dependencies inside each plan).
- Between plans: run `npm install --package-lock-only` if package.json touched.
- After each plan close: gate check `npx tsc --noEmit && npx next build`.
- Log skipped follow-ups (OIDC client absent, SVG asset placeholder, GSI unavailable) to STATE.md > Blockers rather than silently completing.

## Approved for execute-phase.
