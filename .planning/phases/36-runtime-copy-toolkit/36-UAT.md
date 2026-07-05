---
status: partial
phase: 36-runtime-copy-toolkit
source: [36-VERIFICATION.md]
started: 2026-07-05T17:00:00Z
updated: 2026-07-05T17:35:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Deployed cross-region copy propagation (SC-5 / TOOL-04)
expected: A CMS edit reaches use1 + cac1 within ~15 min with no deploy. Requires the run.bib ECS env vars (CMS_INTERNAL_URL, STRAPI_API_TOKEN) to be provisioned first (documented user_setup, due before Phase 37 ships).
result: blocked
blocked_by: prior-phase
reason: "Requires a deployed multi-region run.bib with CMS_INTERNAL_URL + STRAPI_API_TOKEN provisioned in the ECS task def — infra that does not exist yet (a Phase-37 prerequisite). Cannot be exercised from a local/worktree environment. The mechanism is verified present and wired: `revalidate:300` on both the Strapi and S3 fetches AND on the `unstable_cache` wrapper, converging via Litestream (Phase 35). Live cross-region convergence is the only unobservable part."

### 2. Full production build + live self-proof render
expected: `next build` succeeds with the new layout wiring and the hidden `<span data-copy-selftest>` renders "Bib copy toolkit online" in the served HTML; the CMS token/URL are absent from every client chunk.
result: pass
source: automated
reason: "Verified autonomously after completing a full isolated npm install (702 pkgs, Node v23.6.0) in the worktree webapp. (1) `next build` — compiled successfully, TypeScript passed, all 15 pages generated, exit 0. (2) `next start` on :3999 — GET / and /signin both return `data-copy-selftest=\"true\">Bib copy toolkit online</span>` in the served HTML (resolved via the committed-snapshot fallback since no CMS env was set — proves the fallback chain end-to-end). (3) Token boundary — grep of .next/static (client chunks) for CMS_INTERNAL_URL, STRAPI_API_TOKEN, and resolveCopy returns zero matches; only the client-safe copy-core/snapshot symbols appear client-side. The unrelated AuthJS MissingSecret log (no local auth secret) did not affect the copy toolkit render."

## Summary

total: 2
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 1

## Gaps

[none — no code issues found; the one unresolved item is an infra/deploy prerequisite, not a defect]
