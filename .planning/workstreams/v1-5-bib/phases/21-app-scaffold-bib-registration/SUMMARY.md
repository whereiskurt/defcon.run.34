# Phase 21 Plan 21-01 — Execution Summary

**Executed:** 2026-07-02
**Branch:** `gsd/v1.5-wave`
**Result:** 5/5 tasks complete, all gates pass

## Commits

| Task | Hash | Subject |
|------|------|---------|
| 21-01-01 | `677694c3` | scaffold apps/run.bib/webapp package layout |
| 21-01-02 | `927008a8` | mirror run.gpx auth config for run.bib |
| 21-01-03 | `d3b1ee6b` | copy signin/access-denied/middleware/api-auth stubs |
| 21-01-04 | `c8bf819a` | bootstrap app shell + Dockerfile + nginx sidecar |
| 21-01-05 | `d5bfd239` | register bib OIDC client in run.auth |

## Landing-the-plane gates (all PASS)

**`apps/run.bib/webapp/`:**
- `npm install --package-lock-only` → 485 packages
- `npm install` → 155 top-level
- `npx tsc --noEmit` → exit 0
- `npx next build` → 6 routes emitted; middleware compiled as Proxy

**`apps/run.auth/webapp/` (post-bib-client change):**
- `npx tsc --noEmit` → exit 0
- `npx next build` → exit 0

## Deviations from PLAN.md

1. **Middleware gates whole app, not just `/studio`** (Rule 2 — missing critical functionality). run.gpx's `middleware.ts` only guards `/studio/*`; verbatim copy would have left every route reachable without a session. Wrote a whitelist-based gate that runs on all routes (matcher excludes `_next/static`, `_next/image`, common static-asset extensions) and 302s to `/signin` with `callbackUrl` preserved.
2. **Layout mirrored from run.gpx, not run.flash** (Doc-source discrepancy). CONTEXT.md said "mirroring run.flash"; PLAN.md 21-01-04 said "Copy `apps/run.gpx/webapp/src/app/{layout.tsx, providers.tsx}`". Followed PLAN.md.
3. **`.env.example` force-added past `.gitignore`** (Rule 3 — blocking issue). PLAN.md explicitly lists it as a required deliverable; file contains only variable names + safe defaults.

## Known follow-ups (not blocking)

- Next.js 16 `"middleware" file convention is deprecated` warning — same fires in run.gpx; deferred as repo-wide migration
- `LOCAL_BIB_PORT=3004` collides with run.flash's dev port — override via env
- nginx dev cert CN was `strapi.defcon.run` (copied verbatim); `mkcerts.sh` has correct `bib.defcon.run` CN — regenerate before real deploy

## Blockers (unchanged)

- Live payment verification (Phase 22, hardware-in-loop-analog)
- DC34 bib artwork now RESOLVED — `.planning/phases/21-bib-app-scaffold-registration/assets/bib-template.svg` located; will be used by Plan 21-03 BibPreview

## Next

Plan 21-02: `Bib` + `BibReconcile` entities + `/api/bib` routes.
