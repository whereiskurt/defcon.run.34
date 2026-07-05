---
phase: 36-runtime-copy-toolkit
verified: 2026-07-05T17:00:00Z
status: human_needed
score: 4/5 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "A copy edit made in the CMS appears in every region within ~15 min with no deploy (eventual consistency via revalidate:N + Litestream) — SC-5, TOOL-04"
    test: "In a deployed multi-region run.bib (once CMS_INTERNAL_URL + STRAPI_API_TOKEN are provisioned in the ECS task def), edit a ui-string value in the CMS, then poll the same key in use1 and cac1 without redeploying."
    expected: "Both regions serve the new value within ~15 min (Litestream replication ~5 min + revalidate 300s + margin); no deploy required."
    why_human: "Cross-region eventual-consistency is a Next.js Data Cache + Litestream runtime property. The mechanism is present and wired (revalidate:300 on both the Strapi and S3 fetches AND on the unstable_cache wrapper), but actual convergence cannot be exercised by a node-env unit test — it requires a live deployed observation across regions. The 36-01 SUMMARY itself flags coverage D4 (TOOL-04) as human_judgment for exactly this reason."
human_verification:
  - test: "Deployed cross-region copy propagation (SC-5 / TOOL-04)"
    expected: "A CMS edit reaches use1 + cac1 within ~15 min with no deploy."
    why_human: "Runtime eventual-consistency property; not exercisable in code. Requires the run.bib ECS env vars (CMS_INTERNAL_URL, STRAPI_API_TOKEN) to be provisioned first (documented user_setup, due before Phase 37 ships)."
  - test: "Full production build + live self-proof render"
    expected: "`next build` succeeds with the new layout wiring and the hidden <span data-copy-selftest> renders 'Bib copy toolkit online' in the served HTML; the CMS token/URL are absent from every client chunk."
    why_human: "`next build` could not run to completion in this worktree because node_modules is a partial/symlinked install missing ~30 unrelated UI deps (@heroui/react, clsx, next-themes, framer-motion, qrcode, react-icons/*) — a pre-existing environment condition touching none of this phase's files. The server->client no-token-leak boundary is proven here by the import-graph grep + code review + 25 passing unit tests rather than a clean production bundle. A full install + build in a complete environment confirms the bundling guarantee end-to-end."
---

# Phase 36: Runtime Copy Toolkit Verification Report

**Phase Goal:** Any app resolves copy by key through a cached, fallback-safe toolkit that works in both server render and client modals/toasts, never makes a per-element network call, and converges across regions within the propagation window with no deploy.
**Verified:** 2026-07-05T17:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

The toolkit mechanism is built, wired, and self-proven in `run.bib`. Every code-verifiable success criterion holds against the shipped source and 25/25 unit tests pass. The single outstanding item — cross-region live propagation (SC-5) — is a deployed-runtime property that cannot be exercised in code and is routed to human/live verification.

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 (SC-1) | `loadCopy(locale)` returns one already-merged map through the Next.js Data Cache; each `t(key,vars)` is an O(1) in-memory lookup, never a per-element fetch | ✓ VERIFIED | `copy.ts` `loadCopy = unstable_cache((loc)=>resolveCopy(loc),['copy',locale],{revalidate:300,tags:['copy']})`; `copy-core.ts` `t = map[key] ?? key` then `interpolate` (pure, no network). Tests: `copy-core: t`, `interpolate` (10 cases green). |
| 2 (SC-2) | `t()` available in client components via `CopyProvider`/`useCopy` — a client consumer resolves an interpolated key at runtime | ✓ VERIFIED | `CopyProvider.tsx` (`"use client"`) exports `CopyProvider` + `useCopy`; bound `t({...SNAPSHOT_FLOOR, ...context}, key, vars)`. Tests render a consumer via `renderToStaticMarkup` → "Hello Ada" (5 cases green). |
| 3 (SC-3/FALL-02) | With Strapi down or a key missing, toolkit serves S3 export + committed snapshot floor, AND the resolved fallback map is itself cached | ✓ VERIFIED | `resolveCopy` merges snapshot ← S3 ← Strapi, each layer caught independently, never throws; `loadCopy` wraps the whole `resolveCopy` in `unstable_cache` so the returned map *including fallback* is the cached value. Tests: Strapi-fail→S3, both-fail→snapshot, no-token skip (green). Per-window cache timing is a runtime property (see #5). |
| 4 (SC-4/FALL-04/TOOL-05) | UI never renders a raw dotted key; lightweight markdown renders safely client-side | ✓ VERIFIED | Snapshot floor + key-echo last resort (`t`); `copy-markdown.tsx` escape-first (returns React nodes, no raw-HTML injection), whitelist bold/italic/link/br, http/https/mailto scheme allowlist. Tests: XSS `<script>`/`<img onerror>` stay escaped, `javascript:`/`data:` dropped (green). |
| 5 (SC-5/TOOL-04) | A copy edit propagates to every region within ~15 min with no deploy | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Mechanism present + wired: `revalidate:300` on both fetches and the `unstable_cache` wrapper, converging with Litestream (Phase 35). Live cross-region convergence is a deployed-runtime property no node-env test can exercise — routed to human verification. |

**Score:** 4/5 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/copy-core.ts` | client-safe pure `t`/`interpolate` (no env, no server-only, no react) | ✓ VERIFIED | Pure `map[key] ?? key` + `{placeholder}` interpolation; imported by both `copy.ts` (server) and `CopyProvider.tsx` (client) — one shared lookup path. |
| `src/lib/copy.ts` | server-only `loadCopy` + `resolveCopy` seam, cached never-throwing fallback | ✓ VERIFIED | `unstable_cache`-wrapped `loadCopy`; independent try/catch per layer; env read at call time. Server-only by convention (documented) — not `import 'server-only'` (Next 16 vendors it internally). |
| `src/lib/copy-snapshot.json` | committed offline floor with self-proof keys | ✓ VERIFIED | `default` locale with `bib.selftest.serverGreeting`="Bib copy toolkit online", `bib.selftest.clientGreeting`="Hello {name}". |
| `scripts/copy-snapshot.mjs` + `package.json` script | manual/CI-only regen, refuses empty | ✓ VERIFIED | `copy:snapshot` registered; NOT in `build` (`build`=`next build`). Behavioral check: no CMS env → exit 1, floor md5 unchanged. |
| `src/lib/copy-markdown.tsx` | escape-first whitelist renderer, no new dep | ✓ VERIFIED | Zero `dangerouslySetInnerHTML`; no markdown/sanitizer dependency added (package.json deps unchanged). |
| `src/components/CopyProvider.tsx` | client `CopyProvider`/`useCopy`, snapshot floor | ✓ VERIFIED | Imports only `copy-core` + `copy-snapshot.json`; never the server-only `copy.ts`. |
| `src/app/layout.tsx` | `await loadCopy('default')` once + `<CopyProvider>` wrap | ✓ VERIFIED | Line 56 `await loadCopy("default")`; line 74 `<CopyProvider value={copy}>`; hidden `<span data-copy-selftest>` self-proof marker. |
| `.env.example` | documents CMS_INTERNAL_URL + STRAPI_API_TOKEN | ✓ VERIFIED | Both present (read via `git show`); comment: "NEVER expose as NEXT_PUBLIC_*". |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| `layout.tsx` (server) | `copy.ts` `loadCopy` | `import { loadCopy, t } from "@/lib/copy"` + `await loadCopy("default")` | ✓ WIRED |
| `layout.tsx` | `CopyProvider` | `<CopyProvider value={copy}>` wraps children | ✓ WIRED |
| `CopyProvider`/`useCopy` | `copy-core` `t` | bound `t({...SNAPSHOT_FLOOR, ...context}, key)` | ✓ WIRED |
| `copy.ts` `loadCopy` | `unstable_cache(resolveCopy)` | resolved map (incl. fallback) is the cached value | ✓ WIRED |
| `resolveCopy` | S3 export shape | reads `json[locale]` at `cms.${SITE_DOMAIN}/${REGION_SHORT}/cms/copy.json` (matches Phase 35 export) | ✓ WIRED |
| server-only `copy.ts` | client bundle | imported ONLY by `layout.tsx` (server) + test; NO client component imports it | ✓ BOUNDARY INTACT |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase test suite | `npx vitest run copy.test.ts copy-markdown.test.tsx copy-provider.test.tsx` (Node 23.6.0) | 3 files, 25 tests passed | ✓ PASS |
| Phase-file typecheck | `tsc --noEmit`, filter phase files | Only error is pre-existing `clsx` import (layout.tsx:3, untouched line, documented missing UI dep). Phase's new files type-clean. | ✓ PASS |
| Snapshot fail-safe | `env -u CMS_INTERNAL_URL -u STRAPI_API_TOKEN node scripts/copy-snapshot.mjs` | exit 1, floor md5 identical before/after | ✓ PASS |
| Token boundary | grep importers of `@/lib/copy` | only `layout.tsx` (server) + test; no `"use client"` module | ✓ PASS |
| `next build` (full) | — | Not runnable: partial node_modules missing ~30 unrelated UI deps (pre-existing env) | ? SKIP → human verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| TOOL-01 | 36-01 | `loadCopy(locale)` fetches catalog via Data Cache (`revalidate:N`) | ✓ SATISFIED | `fetchStrapi` + `loadCopy` unstable_cache, revalidate:300 |
| TOOL-02 | 36-01, 36-03 | `t(key,vars)` from single merged map + interpolation, no per-element call | ✓ SATISFIED | `copy-core.t`; layout self-proof |
| TOOL-03 | 36-03 | `CopyProvider`/`useCopy` make `t()` client-available | ✓ SATISFIED | CopyProvider + tests |
| TOOL-04 | 36-01 | Edit propagates to all regions ~15 min, no deploy | ⚠️ PRESENT (live-unverified) | revalidate:300 + Litestream wired; needs live obs |
| TOOL-05 | 36-02 | Lightweight markdown renders safely client-side | ✓ SATISFIED | `copy-markdown.tsx` + XSS tests |
| FALL-02 | 36-01 | Strapi-down/missing → cached S3 fallback map | ✓ SATISFIED | `resolveCopy` + cached `loadCopy`; tests |
| FALL-03 | 36-01 | Committed snapshot offline floor | ✓ SATISFIED | `copy-snapshot.json` + regen script |
| FALL-04 | 36-01, 36-03 | UI never renders a raw dotted key | ✓ SATISFIED | snapshot floor + client floor + tests |

All 8 declared requirement IDs map to REQUIREMENTS.md and are marked Complete/Phase 36 there. No orphaned requirements for this phase (ADMN-*/MIGR-* map to Phases 37–39).

### Context Decisions (D-01…D-05) — Honored

| Decision | Status | Evidence |
| -------- | ------ | -------- |
| D-01 per-app file, not shared workspace | ✓ | files in `apps/run.bib/webapp/src/lib`; no `packages/copy/` |
| D-02 first home run.bib | ✓ | all artifacts under run.bib |
| D-03 revalidate 300s | ✓ | `REVALIDATE_SECONDS = 300` |
| D-04 manual/CI-only snapshot, refuses empty, not in build | ✓ | `copy:snapshot` absent from `build`; exit-1-no-write verified |
| D-05 escape-first no-dep markdown renderer | ✓ | no markdown lib; escape-first; whitelist bold/italic/link/br |

### Anti-Patterns Found

None. No `TODO`/`FIXME`/`XXX`/`TBD`/`HACK`/`PLACEHOLDER` in any phase file; no `dangerouslySetInnerHTML`; no stub returns feeding rendering.

### Human Verification Required

1. **Deployed cross-region copy propagation (SC-5 / TOOL-04)** — Once `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN` are provisioned in run.bib's ECS task def (documented user_setup, due before Phase 37 ships), edit a `ui-string` value and confirm both use1 and cac1 serve the new value within ~15 min with no deploy.
2. **Full production build + live self-proof render** — In a complete `node_modules`, run `next build` and confirm the app builds with the new layout wiring, the hidden `data-copy-selftest` marker renders "Bib copy toolkit online" in the served HTML, and no client chunk contains the CMS token/URL.

### Gaps Summary

No blockers. The toolkit mechanism is fully built, wired, and self-proven at the unit level with a clean import-graph security boundary. The two outstanding items are inherent deployed-runtime properties (cross-region eventual consistency and a full production bundle) that cannot be exercised in this worktree — the first because it needs live multi-region infra plus the not-yet-provisioned ECS env vars, the second because the worktree's node_modules is a partial install missing unrelated UI deps. Both are documented, expected, and correctly deferred (the env provisioning is a Phase-37 prerequisite, not a Phase-36 deliverable). Status is `human_needed` rather than `passed` solely because these runtime observations remain.

---

_Verified: 2026-07-05T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
