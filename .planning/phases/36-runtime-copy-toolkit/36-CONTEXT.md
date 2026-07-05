# Phase 36: Runtime Copy Toolkit - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the **runtime copy toolkit** — `loadCopy(locale)` + `t(key, vars)` + `CopyProvider`/`useCopy` — that resolves UI copy by key from a single cached, already-merged map, works in both server render and client components (modals/toasts/handlers), never makes a per-element network call, and converges across regions within ~15 min with no deploy. Includes the fallback chain (Strapi API cached → S3 export → committed snapshot → dev-only key) and the committed-snapshot offline floor.

**Requirements:** TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, FALL-02, FALL-03, FALL-04.

**Explicitly NOT this phase:** wiring the bib donate/sponsor surface end-to-end (that is Phase 37, the proof surface); the custom admin plugin (Phase 38); migrating other apps' copy (Phase 39). This phase builds and self-proves the toolkit mechanism; Phase 37 is its first real consumer.
</domain>

<decisions>
## Implementation Decisions

### Packaging & first home
- **D-01:** Toolkit ships as a **per-app file** (`lib/copy.ts` + a `CopyProvider` component), NOT a shared `packages/copy/` workspace. Matches the existing per-app `lib/strapi.ts` precedent; avoids introducing monorepo workspaces. ~100 lines duplicated to other apps in a later phase is accepted.
- **D-02:** The toolkit's **first home this phase is `run.bib`** (`apps/run.bib/webapp/src`). run.bib is Phase 37's proof surface, so building it here means it gets exercised immediately. Build the canonical implementation here; other apps copy it in Phase 39.

### Data Cache revalidate window
- **D-03:** `revalidate: N` = **300s (5 min)**. Worst-case end-to-end propagation ≈ Litestream cadence (~5 min) + N + margin ≈ ~15 min, matching the milestone's stated eventual-consistency window. One Strapi call per app instance per 5-min window per region.

### Committed snapshot floor (FALL-03)
- **D-04:** **Build the committed snapshot now** (minimal): a `copy:snapshot` npm script that fetches all `default` rows from the CMS and writes a committed `copy-snapshot.json`, imported as a zero-network offline floor. Triggered manually/CI only — never on CMS data change, so no build-time coupling to CMS availability. Delivers the gpx "never break because CMS is down" guarantee and hard-guarantees FALL-04 (never render a raw key) even with both Strapi AND S3 unreachable at a cold start.

### Markdown renderer (TOOL-05)
- **D-05:** **Minimal inline renderer** — escape HTML first, then whitelist a small set (bold, italic, links, line-breaks). No new dependencies, safe by construction, works identically server- and client-side. Do NOT adapt the gpx `blocksToHtml`/sanitizer (it targets Strapi rich-text *blocks* = domain data, a mismatch for inline copy strings) and do NOT pull in a markdown library (bundle weight + XSS surface for no benefit at this scope).

### Claude's Discretion
- Exact resolver internals: `unstable_cache` vs route-level `fetch(..., { next: { revalidate, tags } })` wrapping — planner/researcher choose, but the **resolved merged map must itself be cached** (not just the Strapi fetch), so the fallback is as fast as the happy path (at most one slow/failed Strapi call per window, not per load).
- Strapi fetch timeout (~2.5s `AbortController` per the design doc) and stale-while-revalidate behavior — follow the doc.
- Snapshot file placement (per-app committed JSON vs one shared committed file) — planner's call; lean per-app to match D-01.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design (authoritative)
- `docs/superpowers/specs/2026-07-05-cms-copy-catalog-design.md` — the approved milestone design. §"Copy Toolkit", §"Performance & cached fallback", §"Client-side copy & JavaScript strings", §"S3 Copy Export", §"Committed Snapshot", and §"Open Implementation Details" directly govern this phase. **MUST read before planning.**

### Phase 35 foundation (what this phase reads)
- `apps/run.cms/app/src/api/ui-string/services/copy-export.ts` — the exact S3 export shape/key the toolkit's fallback must read: single object `{ "<locale>": { "<key>": "<value>" } }` at `${REGION_SHORT}/cms/copy.json` (CloudFront-served), `notes` excluded.
- `.planning/phases/35-cms-copy-catalog-foundation/35-SUMMARY.md` + `35-TESTING-NOTES.md` — locale is always `'default'` in v1 (coerced non-null); `notes` is `private` (not in API responses); read-only token `run-human-internal` gates `ui-string` find/findOne.

### Read-path precedent
- `apps/run.human/webapp/src/lib/strapi.ts` — per-app Strapi client pattern (Bearer token from env, BASE_URL). The copy toolkit mirrors the auth/env approach but replaces `cache: 'no-store'` with the `revalidate: N` Data Cache.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/run.human/webapp/src/lib/strapi.ts` — Bearer-token + BASE_URL env wiring to copy for the toolkit's Strapi call (but swap `no-store` → `revalidate: 300`, `tags: ['copy']`).
- `unstable_cache` / time-based revalidation is already used in-repo: `apps/run.human/webapp/src/app/api/checkins/public/route.ts`, `apps/run.gpx/webapp/src/app/api/gpx/public/{aggregate,maps,checkins}/route.ts` — reference implementations for the cached-map wrapper.

### Established Patterns
- Per-app `src/lib/*.ts` utilities (run.bib already has `lib/amount.ts`, `lib/handles.ts`, `lib/stripe.ts`, etc.) — `lib/copy.ts` fits this convention.
- run.bib `src/app/layout.tsx` exists → the natural mount point to call `loadCopy('default')` server-side once and wrap children in `<CopyProvider>`.

### Integration Points
- **run.bib has no `strapi.ts` / CMS client yet** — this phase introduces the CMS read into run.bib. It will need the CMS base URL (regional worker) + the `run-human-internal` read-only token available as env in run.bib's runtime (mirror run.human's env keys). Flag for the planner: confirm/provision those env vars for run.bib.
- Fallback fetch target: CloudFront `cms.<siteDomain>/${REGION_SHORT}/cms/copy.json` (public static JSON).
</code_context>

<specifics>
## Specific Ideas

- Runtime lookup order (from the design doc, locked): Strapi API (cached) → S3 export → committed snapshot → (dev-only) the key itself. The resolver returns a single already-merged map so `t(key, vars)` is `map[key] ?? key` with `{placeholder}` interpolation — merge happens once at resolve time, never per lookup.
- Client path: load once server-side in the layout, pass the resolved map into `<CopyProvider>`, expose `useCopy()` returning `t`; committed snapshot is a plain JSON import so client lookup floor = `context[key] ?? snapshot[key] ?? key`.
- `tags: ['copy']` is attached for a *possible future* manual revalidation but is NOT part of v1 propagation (time-based `revalidate` alone converges).
</specifics>

<deferred>
## Deferred Ideas

- **Wire the bib donate/sponsor surface** (`bib.sponsor.*` / `bib.donate.*` across SponsorForm, SponsorInstructions, GetYourBib, payment/Venmo/CashApp, sponsor/QR/logout modals) — Phase 37 (the proof surface). The toolkit built here is its dependency.
- **Custom three-column admin plugin** — Phase 38.
- **Migrate remaining bib copy + shared chrome (`common.header.*` / `common.profileMenu.*`) + flash/human/auth/gpx** — Phase 39.
- **Shared `packages/copy/` refactor** (de-dup the per-app files) — possible future phase once the per-app pattern proves out; explicitly not now (YAGNI).
- **Manual/admin `revalidateTag('copy')` fan-out** for instant propagation — out of scope; v1 relies on time-based revalidation only.

</deferred>

---

*Phase: 36-runtime-copy-toolkit*
*Context gathered: 2026-07-05*
