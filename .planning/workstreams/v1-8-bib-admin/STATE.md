---
gsd_state_version: 1.0
milestone: v1.8
milestone_name: Bib Admin, Orderform UX & Social QR
status: Planned — Phase 34 CONTEXT + PATTERNS written (task-level plan captured); ready for `/gsd-autonomous` (plan→execute) or direct execution from CONTEXT
last_updated: "2026-07-04T00:00:00.000Z"
last_activity: 2026-07-04 — Phase 34 brief authored: 34-CONTEXT.md (full task-level plan, all 10 decisions) + 34-PATTERNS.md (reuse map)
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# v1.8 Workstream State

## Project Reference

Parent `.planning/PROJECT.md` applies. This workstream touches **`apps/run.bib/`**
(webapp + admin) and one small **additive** change to **`apps/run.human/`**
(extend the internal user endpoint to also return `hash`). NOT parallel-safe with
concurrent run.human work on that endpoint; otherwise isolated to run.bib.

Full design contract: `.planning/workstreams/v1-8-bib-admin/DESIGN.md`, which
references the committed spec at
`docs/superpowers/specs/2026-07-04-bib-admin-and-orderform-design.md`.

## Current Position

Phase: 34 (Bib admin, orderform UX & social QR) — starting
Plan: —
Status: Autonomous build authorized 2026-07-04. Single combined phase (Kurt's
choice). Executing PR-per-phase, merge-on-green per yolo workflow. Ping Kurt when
blocked.

## Accumulated Context

### Decisions (Kurt 2026-07-04)

- **Registration definition:** a bib counts only when it has a name, a payment, or
  an in-person pledge (`isRegistered`). Empty visit-created bibs are filtered from
  admin totals + roster. Keep the auto-create-on-visit behavior.
- **Reconcile scope:** pending Venmo/Cash App intents (owned rows) only — no
  un-owned receipt-email matching this milestone.
- **Reject bib:** delete the bib + that owner's pending intents + reset the
  `bibname_change` quota (via `restore`); KEEP real donations.
- **Checkbox interaction:** checking "$20 in person" still hides the Sponsor tile.
- **Checkbox placement:** responsive — between Sponsor & Donate on mobile,
  full-width below both on desktop (Tailwind breakpoints).
- **Unsaved state:** Save button glows/enlarges + "UNSAVED" stamp on the bib
  preview (same slot as PAID); UNSAVED outranks PAID while dirty.
- **ALTCHA UX:** HeroUI blur-overlay spinner during proof-of-work; remove inline
  "verifying" text.
- **Social QR:** reuse run.human's per-user social-QR value
  (`https://run.<domain>/<region>/r?h=<hash>`) via an extended run.human internal
  endpoint; render bigger; fall back to the runner-code QR when no hash.

### Gated / environment notes

- Reconcile + reject call the run.auth quota service (internal secret). Fine in
  local dev; server enforces on write.
- Social QR needs run.human's internal user endpoint reachable via service
  discovery — implement + unit test; full cross-app E2E may be environment-gated.
