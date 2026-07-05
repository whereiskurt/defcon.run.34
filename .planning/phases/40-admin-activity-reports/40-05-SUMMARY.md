---
phase: 40-admin-activity-reports
plan: 05
subsystem: infra
tags: [runbook, mapbox, operator-docs, cloudwatch, admin-reports, account-hardening]

# Dependency graph
requires:
  - "admin-reports/v1.0.0 module: DefconRun/Activity metric names + the seven admin/* saved queries + site.hcl admin_reports thresholds block (40-04)"
  - "gpx.map.view -> MapViews leading-indicator event and the MAPBOX_DEFAULT_TOKEN resolution path in run.gpx (40-02)"
provides:
  - "infra/terraform/modules/admin-reports/v1.0.0/RUNBOOK.md — Mapbox account-hardening checklist + reading-the-reports operator guide"
affects: [40-07, admin-reports, operations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Account-side controls with no Terraform/app lever captured as a module-local RUNBOOK.md alongside the code that implements the code-side half"

key-files:
  created:
    - infra/terraform/modules/admin-reports/v1.0.0/RUNBOOK.md
  modified: []

key-decisions:
  - "RUNBOOK.md placed inside the module dir (admin-reports/v1.0.0/) rather than the phase dir, so the human counterpart to the metrics/queries/alarms travels with the module"
  - "Documented the optional per-app-token code lever (split MAPBOX_DEFAULT_TOKEN in run.gpx's mapbox-token.ts) as a pointer for a follow-up, not implemented here — plan scoped this plan to docs only"
  - "URL-restriction (step 1.1) called out as THE CRITICAL CONTROL because the public token is scrapeable from client JS; the other three steps backstop it"

requirements-completed: [AR-08]

# Metrics
duration: ~7min
completed: 2026-07-05
status: complete
---

# Phase 40 Plan 05: admin-reports Operator Runbook Summary

**A single `RUNBOOK.md` in the `admin-reports/v1.0.0` module capturing the account-side controls that have no code lever: the four-step Mapbox account-hardening checklist (URL-restrict the scrapeable public token — the critical control — plus per-app token, spending cap, and the `gpx.map.view`/`MapViews` real-time leading indicator that substitutes for Mapbox's absent, ~24h-lagged usage API), and a reading-the-reports guide covering the dashboard, the distinct-active-users and top-IPs widgets, the seven `admin/*` saved queries with the edit-the-placeholder dig-in workflow, and the `site.hcl` pre-con→con-week threshold-bump.**

## Performance
- **Duration:** ~7 min
- **Completed:** 2026-07-05
- **Tasks:** 2
- **Files:** 1 (1 created)

## Accomplishments

- **Task 1 — Mapbox account-hardening checklist (AR-08b):** Created `RUNBOOK.md` with a numbered operator checklist, each step giving the exact Mapbox console location:
  1. **URL-restrict** the public token to `*.defcon.run` origins — explicitly flagged as **THE CRITICAL CONTROL** because the token ships to the browser and is scrapeable from client JS; restricting origin is the only thing that stops a scraped token being spent off-domain.
  2. **Dedicated per-app token** (gpx at minimum) so the Mapbox dashboard's per-token usage filter can attribute traffic.
  3. **Spending cap** on the Mapbox account as the hard bill-bounding backstop.
  4. **`gpx.map.view` → `MapViews`** (DefconRun/Activity) documented as the real-time leading indicator, with the operational rule to watch `MapViews` live and treat Mapbox's ~24h-lagged dashboard as billing reconciliation only (no Mapbox usage API exists).
  - Documented the **optional code lever**: split `MAPBOX_DEFAULT_TOKEN` (`apps/run.gpx/webapp/src/lib/mapbox-token.ts`, served by `.../api/user/mapbox-token/route.ts`) into a dedicated per-app var for a follow-up.
- **Task 2 — Reading-the-reports operator guide:** Appended a section covering how to open the `admin-reports` dashboard (us-east-1); the **distinct-active-users-last-hour** headline widget and **top-IPs** widget; a table of all seven `admin/*` saved queries; the **edit-the-placeholder** workflow for `admin/user-activity` (`PUT-USER-ID-HERE`/`PUT-EMAIL-HERE`) and `admin/ip-activity` (`PUT-IP-HERE`); and the **con-week threshold bump** — edit `admin_reports.thresholds` in `site.hcl` (`signups_per_hour`/`gpx_uploads_per_hour`/`alb_5xx_per_5min`) then `terragrunt apply` the self-contained `us-east-1/admin-reports` unit. The **pre-con posture is stated explicitly**: `Signups >= 1/hr` firing is expected signal, not noise.

## Task Commits
1. **Task 1: Mapbox account-hardening checklist** — `e2ea9df1` (docs)
2. **Task 2: reading-the-reports operator guide** — `b5e585bb` (docs)

## Verification
- **Task 1 automated verify** — `test -f RUNBOOK.md && grep -c 'defcon.run'` → file exists, 4 matches (> 0). Acceptance greps: `URL-restrict`, `per-app token` (x2), `spending cap`, `gpx.map.view`/`MapViews` all present; `THE CRITICAL` / "critical control" present.
- **Task 2 automated verify** — `grep -c 'distinct\|admin/\|site.hcl'` → 19 matches. Acceptance greps: `distinct` (x2), `admin/user-activity`, `admin/ip-activity`, `site.hcl` (x5), pre-con/con-week (x11), `Signups >= 1` all present.
- Final RUNBOOK.md: 189 lines, prose only (no fenced code except the two operator copy-paste `terragrunt apply` / token-var snippets, which are actionable commands not implementation).

## Deviations from Plan
None — plan executed exactly as written. Both tasks are documentation appends to a single file; no auto-fixes, no blockers, no architectural decisions.

## Known Stubs
None. The RUNBOOK is complete prose. The only placeholders referenced (`PUT-USER-ID-HERE` etc.) are the intentional operator-editable tokens inside the 40-04 saved queries, documented here as a workflow — not stubs in this deliverable.

## Next Plan Readiness
- 40-07 (live deploy) can hand this RUNBOOK to the operator: the Mapbox steps are the account-side work the operator performs by hand (no Terraform), and the reading-the-reports guide is the day-one dashboard/query/threshold reference.
- The optional per-app Mapbox token code lever is documented for a future follow-up but is not required by this phase.

## Self-Check: PASSED
- Created file present on disk: `infra/terraform/modules/admin-reports/v1.0.0/RUNBOOK.md`.
- Both task commits present in git history (`e2ea9df1`, `b5e585bb`).

---
*Phase: 40-admin-activity-reports*
*Completed: 2026-07-05*
