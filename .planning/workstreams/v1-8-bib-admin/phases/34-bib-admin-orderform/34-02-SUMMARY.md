---
phase: 34-bib-admin-orderform
plan: 02
subsystem: bib-social-qr
tags: [social-qr, internal-api, service-discovery, run-human, run-bib]
requires:
  - run.human internal user endpoint (X-Internal-Secret gate)
  - run.bib quota-client service-discovery pattern
provides:
  - run.human internal user JSON `hash` field
  - run.bib getSocialQrHash(ownerSub) + buildSocialQrUrl(hash)
affects:
  - apps/run.human/webapp internal user endpoint
  - apps/run.bib/webapp lib (consumed later by orderform thread — C-T3/C-T4)
tech-stack:
  added: []
  patterns:
    - "server-to-server internal fetch with X-Internal-Secret + fixed service-discovery host (no SSRF)"
    - "null-safe cross-app resolver (catch-all → null) so a QR miss never 500s the page"
key-files:
  created:
    - apps/run.bib/webapp/src/lib/social-qr.ts
    - apps/run.bib/webapp/src/__tests__/social-qr.test.ts
  modified:
    - apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts
decisions:
  - "Target run.human's internal user endpoint (not run.auth): the hash lives on RunUser, mirroring quota-client's host pattern with a HUMAN_INTERNAL_URL override + /{region} basePath in prod"
  - "buildSocialQrUrl reads env at call time so vi.stubEnv-driven overrides apply"
  - "Only `hash` added to the endpoint — seed / RSA key-pair hashes stay run.human-internal (T-34-05)"
metrics:
  duration: ~10m
  completed: 2026-07-04
  tasks: 2
  files: 3
status: complete
---

# Phase 34 Plan 02: Social QR Backend Summary

Extended run.human's internal user endpoint to additively return the runner's `hash`, and added a run.bib server-side lib (`getSocialQrHash` + `buildSocialQrUrl`) that resolves that hash via service discovery and builds the `/r?h=` social-QR URL — with a catch-all null fallback so a QR miss never breaks the orderform.

## What Was Built

### Task 1 — run.human endpoint additively returns `hash`
- Added exactly one field, `hash: user.hash`, to the success `NextResponse.json({...})` in `apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts`.
- `hash` is the SHA256 QR-lookup value already surfaced in public `/r?h=` URLs — not a secret. The `X-Internal-Secret` gate, accounts→adapter lookup, and every existing field are untouched. No `seed` / `rsaprivSHA` / `rsapubSHA` exposed (T-34-05 mitigation).
- Verified `npx next build` green in `apps/run.human/webapp`.

### Task 2 — run.bib social-qr lib (TDD)
- New `apps/run.bib/webapp/src/lib/social-qr.ts`:
  - `getSocialQrHash(ownerSub): Promise<string | null>` — GETs run.human's internal user endpoint (service-discovery host mirroring quota-client, `HUMAN_INTERNAL_URL` override, `/{region}` basePath in prod), sends `X-Internal-Secret`, returns `hash` when a non-blank string, else null. Whole body wrapped in try/catch → null; non-2xx → null (T-34-07: a QR miss/timeout never 500s the orderform).
  - `buildSocialQrUrl(hash): string` — returns `https://run.${SITE_DOMAIN || "defcon.run"}/${REGION_SHORT || "use1"}/r?h=${hash}`, reading env at call time.
- New `apps/run.bib/webapp/src/__tests__/social-qr.test.ts`: 6 cases — URL defaults, URL env overrides, hash present, hash absent → null, fetch rejects → null, non-2xx → null.
- RED (test-first, module absent) → GREEN (6/6 pass) via separate commits.

## Verification

- `npx vitest run src/__tests__/social-qr.test.ts` → **6 passed** (node v23.6.0).
- `npx next build` green in `apps/run.human/webapp` after the additive `hash` field.
- Acceptance greps pass: `hash: user.hash` present; `seed:|rsaprivSHA` count = 0; `export function buildSocialQrUrl`, `export async function getSocialQrHash`, and `/r?h=` all present.

## Deviations from Plan

None — plan executed as written. One in-task correction (not a plan deviation): an initial code comment in the run.human route literally contained the token `rsaprivSHA`, tripping the acceptance grep `grep -Ec "seed:|rsaprivSHA"` (returned 1). Reworded the comment to describe the secrets without the literal tokens; grep now returns 0. Functionality unchanged.

## Threat Model Coverage

- **T-34-05** (info disclosure, run.human JSON) — mitigated: only `hash` added; no secret RunUser fields; internal-secret gate unchanged.
- **T-34-06** (info disclosure, bib→human fetch) — mitigated: secret read server-side only, sent as header, never logged; fixed service-discovery host (no user-controlled URL → no SSRF).
- **T-34-07** (DoS, hash fetch) — mitigated: `getSocialQrHash` catches all errors and non-2xx → null; orderform falls back to runner-code QR.
- **T-34-SC** (npm installs) — no new packages; global `fetch` + existing env only.

No new threat surface beyond the register.

## Notes for Downstream (C-T3 / C-T4)

- `getSocialQrHash` / `buildSocialQrUrl` are unwired so far — the orderform thread (`orderform/page.tsx` → `GetYourBib` → `BibForm` → `BibPreview`) consumes them next: `const socialQrUrl = hash ? buildSocialQrUrl(hash) : null`, rendered enlarged with a runner-code fallback.
- The live cross-app hop (run.bib → run.human internal endpoint) is unit-tested via mocked `fetch` only; a fresh sandbox without service discovery still ships the runner-code fallback (bib never renders a blank stub).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: apps/run.human/webapp/src/app/api/internal/user/[oidcSub]/route.ts (modified)
- FOUND: apps/run.bib/webapp/src/lib/social-qr.ts
- FOUND: apps/run.bib/webapp/src/__tests__/social-qr.test.ts
- Commits verified below.
