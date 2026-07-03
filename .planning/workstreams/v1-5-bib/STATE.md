---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Bib Registration
status: Phases 20–23 SHIPPED + DEPLOYED — bib.defcon.run live at v0.0.18. Milestone code-complete; open items are live-payment HITL verification + Jesse admin allowlist.
last_updated: "2026-07-03T00:00:00.000Z"
last_activity: 2026-07-03 — STATE reconciled with shipped reality (git audit). Phase 23 infra applied (ECR, CloudFront global+regional, ECS run-bib-use1, bib-reconcile Lambda), then ~25 app hotfix/feedback releases (#267–#315) iterated the live orderform to v0.0.18.
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# v1.5 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream is **parallel-safe with v1.4.1** — touches only `apps/run.bib/` + new infra units under `infra/terraform/live/site/services/run.bib/`.

## Current Position

Phase: 23 - Build/Deploy + Branding — SHIPPED & DEPLOYED (bib.defcon.run live, v0.0.18)
Plan: — (all 4 phases done)
Status: v1.5 code-complete and in production. `/orderform` is the canonical login-gated page (root `/` 307-redirects to it) with the 3-section layout: (1) free "Get your bib" (nameOnBib + willPayInPerson + live DC34-SVG preview, `1337` placeholder), (2) "Sponsor this bib" (custom slider → your paidAmount), (3) "Just donate" (GeneralDonation). Stripe Checkout (2 products) + Venmo/CashApp with `BIB-XXXX` runner-code reconciliation via SES→Haiku Lambda. Name prints on physical bib iff paidAmount ≥ $10 AND not nameLocked. Infra fully applied (ECR, CloudFront, ECS run-bib-use1, bib-reconcile-dc34-use1 Lambda, SSM). Iterated live through feedback batches 1–3 (green palette, amount chips, runner-code placement, sponsor+donate tiles).
Last activity: 2026-07-03 — STATE reconciled with git. Deployed release v0.0.18 (PR #315 multiregion align).

## Merged PRs (v1.5 to date)

| Phase / Plan | PR | Merged |
|---|---|---|
| Phase 20 Infrastructure Foundation | #228 | 2026-07-02 12:03 UTC (Kurt approved) |
| Phase 21 prep + planning (CI wiring + CONTEXT/PATTERNS/PLAN) | #230 | 2026-07-02 12:22 UTC (Kurt approved) |
| Plan 21-01 (Next.js scaffold + auth mirror + bib OIDC client in run.auth) | #233 | 2026-07-02 12:38 UTC (autonomous, ruleset bypass) |
| Plan 21-02 (Bib + BibReconcile entities + /api/bib routes) | #236 | 2026-07-02 12:54 UTC (autonomous, ruleset bypass) |
| Plan 21-03 (BibPreview + BibForm + landing page + runner-code tests) | #237 | 2026-07-02 13:10 UTC (autonomous, ruleset bypass) |
| Phase 22 prep + planning (Payments 4 plans / 15 tasks / PLAN-CHECK PASSED) | #239 | 2026-07-02 |
| Plan 22-03 (SES → Haiku Lambda infra + BudgetCounter) | #240 | 2026-07-02 |
| Plan 22-05 planning (rescope bundle) | #243 | 2026-07-02 |
| Plan 22-01 (Stripe Checkout + slider + webhook) | #244 | 2026-07-02 |
| Plan 22-04 (reconciliation Lambda handler) | #247 | 2026-07-02 |
| Plan 22-02 (Venmo + CashApp instructions pages + SponsorForm handoff) | #249 | 2026-07-02 |
| Plan 22-05 (rescope bundle — 9 commits, closes Phase 22 code-side) | #251 | 2026-07-02 |
| Phase 22 fixup (link checkout sessions to Stripe Product IDs) | #252 | 2026-07-02 |
| Admin-gate fix (email + container-scope cache) | #255 | 2026-07-02 |
| Phase 23 build/deploy + ~25 hotfix/feedback releases (#267–#313) | many | 2026-07-02→03 |
| Phase 23 feedback batch 1 (404 save, name replaces 1337, ASCII, orderform, white border) | #295 | 2026-07-03 |
| Phase 23 feedback batch 2 (sponsor + donate side-by-side tiles) | #299 | 2026-07-03 |
| Phase 23 feedback batch 3 (green palette + amount chips + runner code moved) | #301 | 2026-07-03 |
| run.bib batch (checkout URL fix + slider/payment-icons/rename-quota/gating) | #311 | 2026-07-03 |
| Multiregion service alignment (match auth/flash/human) | #315 | 2026-07-03 |

## Design Contract Summary (Kurt 2026-07-02, authoritative)

- Custom-amount slider (no fixed tiers)
- Login required for ALL giving (no anonymous path)
- Runner reconciliation code `BIB-XXXX` — stable per user, immutable, primary Venmo/CashApp comment key
- Name editable until admin fires global `nameLocked` flag; $10+ paid gates whether name PRINTS on physical bib
- Bib display shows `1337` placeholder → replaced by `nameOnBib` when set
- No sizes on bibs (drop the field)
- Haiku reconciliation via SES → Lambda → DDB (model `claude-haiku-4-5-20251001`, $20/day budget cap)
- Failure notifications back to `defcon.run@gmail.com`
- Venmo/CashApp handles overridable via SSM (default `@defconrun`)

## Blockers/Concerns

### OPEN
- [ADMIN ALLOWLIST — Jesse missing]: `/dc34/secrets/use1/bib/admin/allowlist` currently holds only `whereiskurt@gmail.com` (per 23-01-11 SSM audit). Jesse's identity was expected but is NOT loaded → Jesse cannot use `/api/admin/bib/pledged-unpaid`. Fail-closed by design. Add Jesse's value to the param.
- [LIVE PAYMENT VERIFICATION — HITL for Kurt]: Real Stripe live-mode + a real Venmo/CashApp receipt round-trip can't run in sandbox (test mode works). Post-deploy hardware-in-loop-analog for Kurt on BOTH `/api/checkout/bib` and `/api/checkout/general`. Note: #309 pointed Stripe products at "the new sandbox" — confirm live-vs-test product IDs before real launch.
- [v1.6 backlog carry-over]: anonymous `/api/checkout/general` flow (session-required today); Venmo/CashApp general-donation matcher fallback (currently hits `unmatched`); `byWillPayInPerson` GSI if pledged-unpaid scan latency bites at scale.

### RESOLVED (2026-07-02→03)
- ~~[Phase 23 — infra apply]~~ APPLIED: ECR repos, CloudFront (global+regional), ECS `run-bib-use1` (matches config, no drift), `bib-reconcile-dc34-use1` Lambda (SES S3 trigger armed), SSM audited.
- ~~[Phase 23 — run.auth redeploy for bib OIDC client]~~ SHIPPED via #313 (run.auth bumped alongside run.bib); bib login working in prod.
- ~~[Phase 22 — SSM values]~~ LOADED: Stripe + Anthropic keys populated (23-01-11 audit passed except Jesse allowlist above).

## Reference

- Parent `.planning/ROADMAP.md` — declares v1.5 at phases 20-23
- `.planning/backlog/nrf52840-t1000e-support.md` — companion v1.4.1 workstream (code-side COMPLETE 2026-07-02)
- `.planning/phases/21-bib-app-scaffold-registration/assets/bib-template.svg` — DC34 bib SVG artwork (now consumed by Phase 21 BibPreview component)
