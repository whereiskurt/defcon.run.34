---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Bib Registration
status: planning
last_updated: "2026-07-02T05:46:27.736Z"
last_activity: 2026-07-02 — Phase 20 context captured (5 gray-area decisions locked, headless mode)
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# v1.5 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream is **parallel-safe with v1.4.1** — touches only `apps/run.bib/` + new infra units under `infra/terraform/live/site/services/run.bib/`.

## Current Position

Phase: 20 - Infrastructure Foundation (context captured, ready to plan)
Plan: —
Status: Ready to research/plan Phase 20 — CONTEXT.md written with 5 gray-area decisions
Last activity: 2026-07-02 — Phase 20 context captured (headless mode; ROADMAP.md declared authoritative over stale REQUIREMENTS-v1.5-bib.md)
Resume file: .planning/workstreams/v1-5-bib/phases/20-infrastructure-foundation/20-CONTEXT.md

## Design Contract Summary

Full contract in ROADMAP.md. Key decisions (from Kurt 2026-07-02):

- Custom-amount slider (no fixed tiers)
- Login required for ALL giving (no anonymous path)
- Runner reconciliation code `BIB-XXXX` — stable per user, immutable, primary Venmo/CashApp comment key
- Name editable until admin fires global `nameLocked` flag; $10+ paid gates whether name PRINTS on physical bib
- Bib display shows `1337` placeholder → replaced by `nameOnBib` when set
- No sizes on bibs (drop the field)
- Haiku reconciliation via SES → Lambda → DDB
- Failure notifications back to `defcon.run@gmail.com`
- Venmo/CashApp handles overridable via SSM (default `@defconrun`)

## Blockers/Concerns

- [Phase 22 — LIVE PAYMENT VERIFICATION]: Real Stripe live-mode + real Venmo/CashApp receipt end-to-end can't run in this sandbox. Stripe TEST mode CAN run. Live mode verification is a hardware-in-loop-analog for Kurt post-merge.
- [Phase 20 — SSM VALUES]: Kurt provides Stripe `sk_test_*`, `whsec_*`, and Anthropic `sk-ant-*` via the templated `aws ssm put-parameter` commands from 2026-07-02.

## Reference

- Parent `.planning/ROADMAP.md` — declares v1.5 at phases 20-23
- `.planning/backlog/nrf52840-t1000e-support.md` — companion v1.4.1 workstream (parallel-safe)
