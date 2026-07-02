---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Bib Registration
status: Phase 22 code-side complete (Plan 22-05 rescope done); ready for Phase 23 (Build/Deploy + Branding)
last_updated: "2026-07-02T15:20:00.000Z"
last_activity: 2026-07-02 — Plan 22-05 rescope bundle (7 tasks / 7 commits) executed autonomously in isolated worktree; free-bib print gate + willPayInPerson + GeneralDonation + 2-product Stripe + 3-section landing + naming sweep + sponsor charm + admin gate all delivered
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 8
  completed_plans: 8
  percent: 75
---

# v1.5 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream is **parallel-safe with v1.4.1** — touches only `apps/run.bib/` + new infra units under `infra/terraform/live/site/services/run.bib/`.

## Current Position

Phase: 23 - Build/Deploy + Branding (ready to plan)
Plan: —
Status: Phase 22 code-side complete after Plan 22-05 rescope (2026-07-02 design shift: bib is free; payment orthogonal; 2-product Stripe checkout; naming sweep to "defcon.run"; sponsor charm; admin allowlist gate). Bib registration works end-to-end in sandbox with the new 3-section landing page. Ready to plan Phase 23 (build/deploy).
Last activity: 2026-07-02 — Plan 22-05 (7 commits) executed autonomously in isolated worktree. tsc + vitest (98/98) + next build (10 routes) all clean.

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
| Plan 22-05 (rescope bundle — 7 commits) | (pending PR) | (this branch) |

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

- [Phase 22 — LIVE PAYMENT VERIFICATION]: Real Stripe live-mode + real Venmo/CashApp receipt end-to-end can't run in this sandbox. Stripe TEST mode CAN run. Live mode verification is a hardware-in-loop-analog for Kurt post-merge. Applies to BOTH `/api/checkout/bib` and `/api/checkout/general` after Plan 22-05.
- [Phase 22 — SSM VALUES]: Kurt provides Stripe `sk_test_*`, `whsec_*`, and Anthropic `sk-ant-*` via the templated `aws ssm put-parameter` commands from 2026-07-02. SSM param paths already provisioned in Phase 20 (empty).
- [Phase 22-05 — ADMIN ALLOWLIST]: New SSM param `/dc34/secrets/use1/bib/admin/allowlist` must be created + populated with Kurt/Jesse's OIDC `sub` values before `/api/admin/bib/pledged-unpaid` is usable in prod. Fail-closed by design — empty/missing param = deny all.
- [Phase 23 — Runtime prep]: `bib` OIDC client (registered in run.auth by Plan 21-01) requires a run.auth redeploy for the client to take effect. Also picks up the "defcon.run" provider display-name change from Plan 22-05-05. Can fold into Phase 23 release or a small interim run.auth deploy.
- [v1.6 backlog carry-over from Plan 22-05]: anonymous /api/checkout/general flow (session-required today); Venmo/CashApp general-donation matcher fallback (currently hits `unmatched`); byWillPayInPerson GSI if pledged-unpaid scan latency becomes a problem at scale.

## Reference

- Parent `.planning/ROADMAP.md` — declares v1.5 at phases 20-23
- `.planning/backlog/nrf52840-t1000e-support.md` — companion v1.4.1 workstream (code-side COMPLETE 2026-07-02)
- `.planning/phases/21-bib-app-scaffold-registration/assets/bib-template.svg` — DC34 bib SVG artwork (now consumed by Phase 21 BibPreview component)
