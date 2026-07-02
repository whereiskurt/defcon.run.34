---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Bib Registration
status: Phase 21 code-side complete (#237 merged); ready to plan Phase 22 (Payments)
last_updated: "2026-07-02T13:10:00.000Z"
last_activity: 2026-07-02 — Phase 21 closed autonomously via ruleset bypass (13 tasks / 3 plans across #233 + #236 + #237); 8/8 SCs delivered
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 3
  completed_plans: 3
  percent: 50
---

# v1.5 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream is **parallel-safe with v1.4.1** — touches only `apps/run.bib/` + new infra units under `infra/terraform/live/site/services/run.bib/`.

## Current Position

Phase: 22 - Payments (Stripe + Venmo/CashApp reconciliation via Haiku) (ready to plan)
Plan: —
Status: Phase 21 code-side complete. Bib registration works end-to-end in sandbox: OIDC-gated `bib.defcon.run` scaffold, `Bib` + `BibReconcile` entities on shared electro table, `/api/bib` GET/POST/PATCH, DC34 SVG BibPreview with auto-shrink, BibForm with debounced PATCH + 409 `nameLocked` UX. Ready to plan Phase 22 payments.
Last activity: 2026-07-02 — PR #237 merged; Phase 21 SUMMARY landed; 8/8 SCs delivered.

## Merged PRs (v1.5 to date)

| Phase / Plan | PR | Merged |
|---|---|---|
| Phase 20 Infrastructure Foundation | #228 | 2026-07-02 12:03 UTC (Kurt approved) |
| Phase 21 prep + planning (CI wiring + CONTEXT/PATTERNS/PLAN) | #230 | 2026-07-02 12:22 UTC (Kurt approved) |
| Plan 21-01 (Next.js scaffold + auth mirror + bib OIDC client in run.auth) | #233 | 2026-07-02 12:38 UTC (autonomous, ruleset bypass) |
| Plan 21-02 (Bib + BibReconcile entities + /api/bib routes) | #236 | 2026-07-02 12:54 UTC (autonomous, ruleset bypass) |
| Plan 21-03 (BibPreview + BibForm + landing page + runner-code tests) | #237 | 2026-07-02 13:10 UTC (autonomous, ruleset bypass) |

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

- [Phase 22 — LIVE PAYMENT VERIFICATION]: Real Stripe live-mode + real Venmo/CashApp receipt end-to-end can't run in this sandbox. Stripe TEST mode CAN run. Live mode verification is a hardware-in-loop-analog for Kurt post-merge.
- [Phase 22 — SSM VALUES]: Kurt provides Stripe `sk_test_*`, `whsec_*`, and Anthropic `sk-ant-*` via the templated `aws ssm put-parameter` commands from 2026-07-02. SSM param paths already provisioned in Phase 20 (empty).
- [Phase 23 — Runtime prep]: `bib` OIDC client (registered in run.auth by Plan 21-01) requires a run.auth redeploy for the client to take effect. Can fold into Phase 23 release or a small interim run.auth deploy.

## Reference

- Parent `.planning/ROADMAP.md` — declares v1.5 at phases 20-23
- `.planning/backlog/nrf52840-t1000e-support.md` — companion v1.4.1 workstream (code-side COMPLETE 2026-07-02)
- `.planning/phases/21-bib-app-scaffold-registration/assets/bib-template.svg` — DC34 bib SVG artwork (now consumed by Phase 21 BibPreview component)
