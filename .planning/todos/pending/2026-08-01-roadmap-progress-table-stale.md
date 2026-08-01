---
created: 2026-08-01T00:35:00Z
title: "ROADMAP Progress table is badly stale — completed_phases undercounts by ~15 phases"
area: .planning
priority: low
---

Surfaced while landing Phase 71 (PR #1154). **Pre-existing drift, not caused by that work.**
Bookkeeping only — no code or infrastructure impact.

## What `completed_phases` actually counts

`gsd-tools query state.update-progress` derives `completed_phases` from two ROADMAP signals,
and it currently sums to exactly the stored value:

```
17  phase-level checkboxes matching ^- \[x\] Phase N:
 4  rows in the ## Progress table marked "| Complete |"
--
21  == STATE.md progress.completed_phases
```

(The 4 table rows are Phases 14-17, which ALSO have checkboxes — so they are double-counted.
That is part of the drift, not a separate bug.)

## The drift

**1. The Progress table is months out of date.** Phases long since shipped still read
`Planned` with `0/N` plans:

| Row | Says | Reality |
|---|---|---|
| 18. Build-Time Firmware & Device List Refresh | `v1.4 · 0/3 · Planned` | shipped; VERIFICATION `human_needed` (hardware boot) |
| 19. Dependencies & DCR34 Branding/UX | `v1.4 · 0/2 · Planned` | shipped; VERIFICATION `human_needed` |
| 20. Bib Infrastructure Foundation | `v1.5 · 0/2 · Planned` | shipped (bib is live in prod) |
| 21. Bib App Scaffold + Registration | `v1.5 · 0/2 · Planned` | shipped |
| 26. Header/Nav UX Refresh | `v1.6 · 0/TBD · Planned` | shipped |

**2. Modern phases have no row at all.** Phases 44-72 — including 70 (dialog shell, complete)
and 71 (heat map) — are absent from the table and carry no phase-level checkbox. Only 18 of 32
phase dirs even have a VERIFICATION.md.

**3. Net effect.** `completed_phases: 21` of `total_phases: 32` understates reality
substantially. By the "every PLAN has a SUMMARY" measure, **26** of 32 phases are
implementation-complete. By verification status, 10 are `passed`/`verified` and 8 are
`human_needed`.

## Not a Phase 71 problem

Worth stating plainly, because it was briefly mis-flagged as one during the Phase 71 wrap-up:
Phase 71 is **not** counted as complete by any of these signals — it has no phase-level
checkbox and no Progress-table row. Its true status is `human_needed`, blocked only on the
5-10 Aug con re-probe, and that is recorded correctly in `71-VERIFICATION.md` and `71-UAT.md`.

## Fix (deliberately deferred)

Reconciling this means adjudicating the true status of ~15 phases across five milestones,
several of which have `human_needed` verification debt already tracked in STATE.md's Deferred
Items. That is a bookkeeping session of its own, not an incidental edit — and it should not be
done during con week.

Suggested approach when picked up:
1. Decide whether the `## Progress` table is still the source of truth or should be dropped in
   favour of the phase-level checkboxes (having both is what causes the 14-17 double-count).
2. Backfill or remove rows for Phases 44-72.
3. Re-run `state.update-progress` and confirm the derived count matches the intended one.

⚠️ Note `state.update-progress` also drops the `last_activity_desc` frontmatter key when it
runs — restore it by hand afterwards if present.
