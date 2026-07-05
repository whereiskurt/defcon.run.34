# Phase 36: Runtime Copy Toolkit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-05
**Phase:** 36-runtime-copy-toolkit
**Areas discussed:** Packaging & first home, Revalidate window, Committed snapshot floor, Markdown renderer

---

## Packaging & first home

| Option | Description | Selected |
|--------|-------------|----------|
| Per-app in run.bib | lib/copy.ts in run.bib; matches lib/strapi.ts precedent; run.bib is Phase 37's proof surface so it's exercised immediately | ✓ |
| Per-app in run.human | Build in the main app first; won't hit a real surface until later | |
| Shared packages/copy/ workspace | DRY, but introduces monorepo workspaces — against the spec's YAGNI/per-app lean | |

**User's choice:** Per-app in run.bib (design-doc lean)
**Notes:** run.bib has app/layout.tsx (mount point) and a lib/ dir but no strapi.ts yet — toolkit introduces the CMS read into run.bib.

---

## Revalidate window (N)

| Option | Description | Selected |
|--------|-------------|----------|
| ~300s / 5 min | Doc lean; worst-case ~15 min end-to-end; one Strapi call per instance per window | ✓ |
| ~60s / 1 min | Fresher (~7-10 min) but ~5x more Strapi calls | |
| ~600s / 10 min | Fewer calls; ~20 min propagation | |

**User's choice:** ~300s / 5 min (design-doc lean)
**Notes:** Matches the milestone's stated ~15-min eventual-consistency window.

---

## Committed snapshot floor (FALL-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Build minimal now | copy:snapshot script + committed copy-snapshot.json offline floor; guarantees FALL-04 even with both Strapi and S3 down | ✓ |
| Defer — rely on S3 export alone | Simpler now; both-down/cold-start-no-network can render keys; moves FALL-03 out of phase | |

**User's choice:** Build minimal now (design-doc lean; FALL-03 is scoped to this phase)
**Notes:** Manual/CI-triggered only — no build-time coupling to CMS availability.

---

## Markdown renderer (TOOL-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal inline renderer | Escape then whitelist bold/italic/links/line-breaks; no deps; server+client identical | ✓ |
| Adapt gpx sanitizer/blocksToHtml | Reuse existing code, but it targets Strapi rich-text blocks — a mismatch for inline strings | |
| Small library (marked + DOMPurify) | Full markdown, but bundle weight + XSS surface; overkill | |

**User's choice:** Minimal inline renderer (design-doc lean)
**Notes:** —

---

## Claude's Discretion

- Resolver internals (`unstable_cache` vs route `fetch` next-cache wrapping) — planner's call, but the resolved merged map must itself be cached.
- Strapi fetch timeout (~2.5s AbortController) + stale-while-revalidate — follow the design doc.
- Snapshot file placement (per-app vs one shared committed file) — lean per-app.

## Deferred Ideas

- Bib donate/sponsor wiring → Phase 37 (proof surface).
- Custom admin plugin → Phase 38.
- Remaining bib + shared chrome (common.header.*/common.profileMenu.*) + flash/human/auth/gpx migration → Phase 39.
- Shared packages/copy/ refactor → possible future (YAGNI now).
- Manual revalidateTag('copy') fan-out → out of scope; v1 is time-based revalidation only.
