---
status: testing
phase: 36-runtime-copy-toolkit
source: [36-VERIFICATION.md]
started: 2026-07-05T17:00:00Z
updated: 2026-07-05T17:00:00Z
---

## Current Test

number: 1
name: Deployed cross-region copy propagation (SC-5 / TOOL-04)
expected: |
  In a deployed multi-region run.bib (once CMS_INTERNAL_URL + STRAPI_API_TOKEN are
  provisioned in the ECS task def), editing a ui-string value in the CMS makes both
  use1 and cac1 serve the new value within ~15 min (Litestream ~5 min + revalidate 300s
  + margin) with no redeploy.
awaiting: user response

## Tests

### 1. Deployed cross-region copy propagation (SC-5 / TOOL-04)
expected: A CMS edit reaches use1 + cac1 within ~15 min with no deploy. Requires the run.bib ECS env vars (CMS_INTERNAL_URL, STRAPI_API_TOKEN) to be provisioned first (documented user_setup, due before Phase 37 ships).
result: [pending]

### 2. Full production build + live self-proof render
expected: `next build` succeeds with the new layout wiring and the hidden `<span data-copy-selftest>` renders "Bib copy toolkit online" in the served HTML; the CMS token/URL are absent from every client chunk. (Blocked in this worktree only by the pre-existing partial node_modules — a full install + build in a complete environment confirms the bundling guarantee end-to-end.)
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
