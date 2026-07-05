---
phase: 1
phase_slug: cms-session-bump
workstream: v1-9-gpx-strapi
status: passed
verified: 2026-07-05
method: direct-inspection
---

# Phase 1 — CMS session bump — Verification

**Goal (ROADMAP):** Raise the Strapi admin session lifespan from 600s to 7200s (2h) via
`config/admin.ts` `env.int` defaults for `maxRefreshTokenLifespan` + `idleRefreshTokenLifespan`;
keep the 5-min access token (`ADMIN_ACCESS_TOKEN_LIFESPAN` = 300); confirm no Terragrunt/ECS
env pins the old 600s values. Tradeoff accepted per design decision D9.

**Requirement:** GPXCMS-01 — satisfied.

## Goal-backward checks (evidence)

| Success criterion | Result | Evidence |
|---|---|---|
| SC1: max + idle refresh default to 7200s (2h) | ✅ PASS | `apps/run.cms/app/config/admin.ts:12-13` — `env.int('ADMIN_MAX_REFRESH_LIFESPAN', 7200)` and `env.int('ADMIN_IDLE_REFRESH_LIFESPAN', 7200)`, comments `// 2 hours` |
| Access token still rotates at 5 min | ✅ PASS | `admin.ts:11` — `env.int('ADMIN_ACCESS_TOKEN_LIFESPAN', 300)` unchanged |
| Session return block still derives from refresh consts | ✅ PASS | `admin.ts:33-34` — `maxSessionLifespan`/`idleSessionLifespan` reference the (now 7200) consts; block untouched |
| SC2: deployed env confirmed not to override the defaults | ✅ PASS | `grep -rn 'ADMIN_(MAX_REFRESH\|IDLE_REFRESH)_LIFESPAN' infra/ apps/run.cms` (excl. node_modules + config/admin.ts) → **zero hits**. No Terragrunt/ECS/`.env`/Dockerfile pins the old 600s value, so the code default takes effect at runtime. |

## Verdict

**PASSED.** All success criteria met; GPXCMS-01 delivered. Code-complete.

**Deploy note:** The new session lifespan only takes effect after a **run.cms release/deploy**
(the running Strapi task must be rebuilt/restarted to pick up the new default). Release is out of
scope for this phase — schedule a run.cms deploy to activate the 2h session in production.

## Commits
- `9f353913` — feat(01-01): bump CMS admin refresh lifespan defaults to 7200s (2h)
- `554fa7b7` — docs(01-01): complete cms-session-bump plan
