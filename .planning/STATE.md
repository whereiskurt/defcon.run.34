---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Bib Registration
current_phase: 19
status: Planned — Phase 19 ready to execute
stopped_at: v1.5 milestone planned; Phase 19 plans authored
last_updated: "2026-07-01T00:00:00.000Z"
last_activity: 2026-07-01
last_activity_desc: Planned v1.5 Bib Registration (bib.defcon.run), phases 19-22; Phase 19 fully planned
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 8
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Core value:** Participants and organizers have a seamless digital experience for DCR34 -- from device setup to event discovery to route navigation.
**Current focus:** v1.5 Bib Registration -- Phase 19 (Infrastructure Foundation) ready to execute. See `.planning/AUTONOMOUS-BUILD.md` for the headless build runbook.

## Current Position

Milestone: v1.5 Bib Registration (bib.defcon.run)
Phase: 19 of 22 (Bib Infrastructure Foundation) -- PLANNED, ready to execute
Plan: 0 of 2 in current phase
Status: Milestone planned; Phase 19 plans authored (19-01, 19-02). Phases 20-22 have CONTEXT; plan each at its turn (GSD default).
Last activity: 2026-07-01 -- Authored v1.5 roadmap, requirements, Phase 19 plans, and autonomous-build runbook

Progress: [----------] 0% (0/4 v1.5 phases)

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.5]: New service bib.defcon.run -- runner race-bib registration (name on bib + give tiers, multiple payment methods)
- [v1.5]: Mirror flash.defcon.run layout (two-container nginx + Next.js), NOT mqtt's NLB/raw-TCP pattern -- bib is HTTP, served via ALB + CloudFront
- [v1.5]: Reuse the shared run-human-electro DynamoDB table with a new Bib ElectroDB entity (same pattern as CheckIn) -- no new table
- [v1.5]: Login REQUIRED to get a bib -- auth uses the run.gpx Auth.js pattern (copy gpx config/auth.ts + middleware.ts + signin/access-denied, rename cookies sess_gpx->sess_bib and claim to `bib`), with live claim re-validation; full-path AUTH_URL form, not flash's
- [v1.5]: OIDC clients are registered in-repo (apps/run.auth config/oidc.ts + index.ts) -- registering the `bib` client is an autonomous code change + run.auth redeploy
- [v1.5]: Payments are donation/give tiers -- preset $10 / $20 / $50 / $500 (USD), plus "Pay on site (cash)"; amount + provider recorded on the registration
- [v1.5]: MULTIPLE payment methods at LAUNCH -- cash on-site + Stripe (cards + Apple/Google Pay) + PayPal/Venmo, all behind one provider-agnostic PaymentProvider seam (lib/payments/) with a registry, provider-generic webhook route, shared idempotent `paid` transition, and a `fake` provider for CI. A checkout method-chooser lists only enabled providers.
- [v1.5]: Claude scaffolds working Stripe (test mode) AND PayPal/Venmo (sandbox) providers; the other dev owns only the real Stripe account/keys + go-live. Crypto (BTC/ETH) is seam-ready but DEFERRED (rail Coinbase vs BTCPay TBD; tracked as PAY-01)
- [v1.5]: Phase 19 creates SSM slots for BOTH processors (stripe_*, paypal_*) so Phase 21 needs no infra change
- [v1.5]: Registration UI is a standard physical-looking RACE BIB (big number + name + DC34 branding, name auto-shrinks to fit with ~32-char cap, live preview as you type) -- one swappable component; prior-year layouts are external reference the user will provide
- [v1.5]: Ship through the EXISTING GitHub Actions held-release pipeline (buildpub.yml opens a held Release PR via release-all.sh; deploy.yml merges + deploys per-region). bib piggybacks by being added to the apps lists; no new workflow
- [v1.5]: Bib Registration is milestone v1.5. A separate v1.4 Flash Service Refresh is being planned independently (the two coexist). Bib phases are provisionally 19-22 -- may shift if v1.4 Flash Refresh claims overlapping phase numbers; confirm range once Flash Refresh is scoped.

### Pending Todos

None.

### Blockers/Concerns

- Claude scaffolds working Stripe + PayPal providers this milestone. External deps: real Stripe account/keys (other dev, go-live) and PayPal sandbox app (client id/secret + webhook id) for dev/testing -- populate the Phase-19 SSM slots out-of-band.
- Crypto (BTC/ETH) provider deferred -- seam ready; needs a rail decision (Coinbase Commerce vs BTCPay) before implementation
- `bib` OIDC client must be registered in run.auth (autonomous code change) + a user granted the `bib` service claim before auth E2E works
- Open product question: whether a deferred *online* pay-later path is wanted in addition to cash-on-site, and whether organizers need a UI to mark cash registrations paid (may defer to a later phase)

## Session Continuity

Last session: 2026-07-01
Stopped at: v1.5 plan authored and landed on main (planning only -- no implementation yet)
Resume file: .planning/phases/19-bib-infrastructure-foundation/19-01-PLAN.md

## Operator Next Steps

- Execute Phase 19 (19-01-PLAN.md) -- self-contained infra. See `.planning/AUTONOMOUS-BUILD.md` for the headless/EC2 build runbook and externally-gated prerequisites.
