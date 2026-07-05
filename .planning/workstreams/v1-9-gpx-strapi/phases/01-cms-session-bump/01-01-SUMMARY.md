---
phase: 01-cms-session-bump
plan: 01
subsystem: run.cms
tags: [strapi, admin-session, config, oidc]
requires: []
provides:
  - "CMS admin refresh lifespan defaults raised to 7200s (2h)"
affects:
  - apps/run.cms/app/config/admin.ts
tech-stack:
  added: []
  patterns:
    - "env.int-overridable config defaults in config/admin.ts"
key-files:
  created: []
  modified:
    - apps/run.cms/app/config/admin.ts
decisions:
  - "D9: accept ~2h CMS access-revocation latency for the small trusted editor pool"
metrics:
  duration: ~2m
  completed: 2026-07-05
status: complete
requirements: [GPXCMS-01]
---

# Phase 01 Plan 01: CMS Session Bump Summary

Raised the Strapi CMS admin refresh-token lifespan defaults from 600s (~10 min) to 7200s (2h) so editors stay logged in for a realistic authoring session, keeping the 5-minute access-token rotation unchanged.

## What Was Built

- **Task 1 (code):** In `apps/run.cms/app/config/admin.ts`, changed the `env.int` defaults for `maxRefreshTokenLifespan` (`ADMIN_MAX_REFRESH_LIFESPAN`) and `idleRefreshTokenLifespan` (`ADMIN_IDLE_REFRESH_LIFESPAN`) from `600` to `7200`, and updated their trailing `// 10 minutes` comments to `// 2 hours`. `accessTokenLifespan` (`ADMIN_ACCESS_TOKEN_LIFESPAN`, default 300) is unchanged. The `sessions` return block was left untouched — `maxSessionLifespan` / `idleSessionLifespan` derive from the refresh consts and follow the new value automatically.
  - Commit: `9f353913`
- **Task 2 (verification-only):** Ran the plan's scoped grep over `infra/` and `apps/run.cms` (excluding `node_modules` and the legitimate `config/admin.ts` reference) for `ADMIN_MAX_REFRESH_LIFESPAN` / `ADMIN_IDLE_REFRESH_LIFESPAN`. Result: **zero hits** — no Terragrunt/ECS task-def, Dockerfile/compose, or `.env` layer pins the old 600s value, so the new 7200s code defaults take effect at runtime. `test -z` guard printed `PASS`.

## Verification Results

- `ADMIN_MAX_REFRESH_LIFESPAN', 7200` — present ✓
- `ADMIN_IDLE_REFRESH_LIFESPAN', 7200` — present ✓
- `ADMIN_ACCESS_TOKEN_LIFESPAN', 300` — present (unchanged) ✓
- No `ADMIN_(MAX|IDLE)_REFRESH_LIFESPAN', 600` remains ✓
- `sessions` return block unchanged (still references refresh consts) ✓
- Infra/env override grep: **0 hits** ✓ (Task 1 verify: `PASS`, Task 2 verify: `PASS`)

## Deviations from Plan

None - plan executed exactly as written.

## Threat Flags

None — no new security surface introduced. Threat T-01-01 (access-revocation latency) is the accepted D9 tradeoff; T-01-02 (infra env pin) was mitigated by Task 2's grep confirming no override exists.

## Self-Check: PASSED

- `apps/run.cms/app/config/admin.ts` — FOUND (modified)
- Commit `9f353913` — FOUND
