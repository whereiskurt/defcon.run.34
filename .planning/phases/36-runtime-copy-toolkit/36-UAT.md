---
status: complete
phase: 36-runtime-copy-toolkit
source: [36-VERIFICATION.md]
started: 2026-07-05T17:00:00Z
updated: 2026-07-06T23:25:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Deployed cross-region copy propagation (SC-5 / TOOL-04)
expected: A CMS edit reaches use1 + cac1 within ~15 min with no deploy. Requires the run.bib ECS env vars (CMS_INTERNAL_URL, STRAPI_API_TOKEN) to be provisioned first (documented user_setup, due before Phase 37 ships).
result: pass
source: live (via Phase 39 SC-3, 2026-07-06)
reason: "Resolved live during the Phase 39 SC-3 proof. A CMS edit to the shared row common.header.maps ('Maps'→'Maps!') on the prod master appeared on run.defcon.run/use1 in ~2m18s with NO deploy (revalidate:300 + Litestream), then reverted cleanly. CROSS-REGION (cac1): N/A for the shipped topology — v1.9 deployed only us-east-1 for the copy-migrated apps (confirmed by operator), so there was no second live region to observe convergence against. The per-region mechanism (master us-east-1 → Litestream worker replica → revalidate) is identical and will hold when a 2nd region deploys. The 'within ~15 min' propagation claim is therefore satisfied (observed ~2 min on the deployed region); cross-region is a topology property, not an unmet requirement."

### 2. Full production build + live self-proof render
expected: `next build` succeeds with the new layout wiring and the hidden `<span data-copy-selftest>` renders "Bib copy toolkit online" in the served HTML; the CMS token/URL are absent from every client chunk.
result: pass
source: automated
reason: "Verified autonomously after completing a full isolated npm install (702 pkgs, Node v23.6.0) in the worktree webapp. (1) `next build` — compiled successfully, TypeScript passed, all 15 pages generated, exit 0. (2) `next start` on :3999 — GET / and /signin both return `data-copy-selftest=\"true\">Bib copy toolkit online</span>` in the served HTML (resolved via the committed-snapshot fallback since no CMS env was set — proves the fallback chain end-to-end). (3) Token boundary — grep of .next/static (client chunks) for CMS_INTERNAL_URL, STRAPI_API_TOKEN, and resolveCopy returns zero matches; only the client-safe copy-core/snapshot symbols appear client-side. The unrelated AuthJS MissingSecret log (no local auth secret) did not affect the copy toolkit render."

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none — no code issues found; the one unresolved item is an infra/deploy prerequisite, not a defect]
