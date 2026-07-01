---
title: Fleet Simulator + Easter Egg
deferred_from: v1.3 Meshtk Integration (Phase 18)
deferred_on: 2026-07-01
reason: Non-essential easter egg; deferred to prioritize v1.4 Flash Service Refresh
requirements: [FLEET-01, FLEET-02, FLEET-03, FLEET-04]
---

# Fleet Simulator + Easter Egg (deferred from v1.3 Phase 18)

**Goal:** Simulated ghost fleet populates meshmap with moving nodes and a hidden
easter egg rewards discovery.

Deferred out of milestone v1.3 (Meshtk Integration) when v1.3 was closed after
Phases 14–17. Explicitly the "non-essential" ghost/easter-egg feature. Pull back
into a future milestone via `/gsd-review-backlog` when prioritized.

## Success Criteria (from original Phase 18)

1. Fleet simulator publishes simulated node positions via MQTT that appear on
   meshmap following GPX-based movement paths.
2. Simulation lifecycle ramps up nodes gradually, maintains steady-state, and
   ramps down with configurable timing.
3. Konami code or theme toggle on meshmap reveals ghost nodes with custom icons
   and triggers an accomplishment API call to run.defcon.run.

## Requirements

- **FLEET-01 … FLEET-04** — see archived `.planning/milestones/v1.3-REQUIREMENTS.md`
  after v1.3 completion.

## Notes

- Depends on the meshmap deployed in Phase 17 (DC34-branded, live nodes).
- The `ghosts` container already exists in the mqtt 4-container ECS task
  (built in Phase 15) — this phase was to drive it with GPX movement + the
  meshmap-side reveal UX.
