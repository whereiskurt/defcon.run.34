# Phase 37: Bib Donate/Sponsor Proof Surface - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the **bib donate/sponsor surface** to read all of its copy from the catalog end-to-end — the primary motivating surface and the deliberately hardest case (client-side, interpolated, modal-heavy) — proving the Phase 36 toolkit before the broader Phase 39 migration. Replace inline JSX copy literals with catalog-resolved keys via the existing toolkit: `t(copy, key)` / `renderCopy` on the server, `useCopy()` in client components, `{placeholder}` interpolation for dynamic strings (e.g. `Sponsor {amount}`, `Pay via {provider}`).

**Requirements:** MIGR-01.

**In-scope surfaces (locked this discussion):**
- `SponsorForm` (client) — amount labels, "Payment method", provider pill labels, CTA `{ctaLabel} {amount}`, "Redirecting…", the Venmo/CashApp approval note, the error sentence.
- `SponsorInstructions` (server) — "Pay via {provider}", "Send to", "Required comment" + hint, "Open {provider}", the long post-payment note (with `{runnerCode}`).
- `/sponsor/venmo` + `/sponsor/cashapp` pages (server) — any inline copy passed into SponsorInstructions.
- `GetYourBib` → `BibForm` (client) — bib name-entry copy (criterion 1 names GetYourBib explicitly; kept in 37, D-04).
- `RunnerCodeBadge`, payment icons captions, and the **sponsor / QR / logout modals** (`user-dropdown` / `menu-dropdown`) — named directly in the success criteria.

**Explicitly NOT this phase:** shared chrome (`common.header.*` / `common.profileMenu.*` / `common.footer.*`), admin surfaces, other apps — all Phase 39. The custom three-column admin plugin is Phase 38. aria-labels + dev/error microcopy tokens (e.g. `HTTP 500`) stay as literals (D-03).

**Success criteria (from ROADMAP, locked):**
1. SponsorForm, SponsorInstructions, GetYourBib, and payment/Venmo/CashApp instruction copy render from `bib.sponsor.*` / `bib.donate.*` keys, not inline literals.
2. Sponsor / QR / logout modals and their interpolated strings (e.g. "You sponsored {amount}") resolve through `useCopy()` inside client handlers.
3. Editing a bib donate/sponsor string in the CMS changes the rendered wording within the propagation window with no deploy.
4. With the CMS unavailable, the copy still renders via the fallback chain — never a raw dotted key.
</domain>

<decisions>
## Implementation Decisions

### Seeding & source of truth (satisfies SC-3 + SC-4)
- **D-01:** **Author the committed `copy-snapshot.json` as the source of truth, then import to CMS.** For every migrated literal, add a `(key → default value)` entry to `apps/run.bib/webapp/src/lib/copy-snapshot.json` (the offline floor), then a one-shot import script POSTs the same `(key, locale='default', value, namespace='bib')` rows into Strapi via the write API (admin token, NOT the read-only `run-human-internal` token). Regenerating via the existing `copy:snapshot` script must round-trip cleanly. This satisfies **both** the fallback-proof (SC-4, snapshot present) and the edit-proof (SC-3, Kurt edits a live CMS row and sees it change) in a single authoring pass. Resolve the chicken/egg (CMS empty until we author) by making the committed snapshot the authored artifact and the CMS a derived import.

### Server-component copy access
- **D-02:** **Server components/pages call the cached `loadCopy('default')` directly** and use `t(copy, key)` / `renderCopy(t(copy, key))` locally — mirroring the existing `layout.tsx` pattern. `loadCopy` is wrapped in `unstable_cache`, so repeated calls within a request/window are O(1)/free; no prop-threading gymnastics and no new server helper needed. A server page that renders `SponsorInstructions` resolves the strings it needs and passes finished text (or the `copy` map) down — planner picks prop shape, but the fetch stays `loadCopy()`.

### Copy scope (what migrates)
- **D-03:** **Visible labels + sentences + CTAs + interpolated strings migrate; aria-labels and dev/error microcopy tokens stay literal.** Migrate everything a participant reads: labels ("Sponsor amount"), headings, instruction sentences, button/CTA text incl. interpolated (`{ctaLabel} {amount}`, `Pay via {provider}`, `You sponsored {amount}`), and modal copy. Leave `aria-label="…"`, accessibility-only strings, and error detail tokens (`HTTP 404`, `network`) as code literals — they're not editor-facing and would bloat the catalog. The *user-facing error sentence* ("Could not start checkout … — try again") DOES migrate; the interpolated `{detail}` token stays raw.

### 37 ↔ 39 boundary
- **D-04:** **BibForm / GetYourBib name-entry copy is in Phase 37** (full donate/sponsor vertical proof). Criterion 1 lists GetYourBib explicitly and it sits in the same purchase flow, so 37 proves the whole donate/sponsor page top-to-bottom. Phase 39 keeps only: shared `common.*` chrome (header/profile-menu/footer), admin surfaces, and any remaining non-flow bib copy.

### Key naming (derived from design doc + roadmap)
- **D-05:** Keys follow the locked convention `<namespace>.<area>.<element>` (design doc §"Key naming"), namespace `bib`. Because `SponsorForm` renders both variants with *distinct words* ("Sponsor amount" vs "Donation amount", "Sponsor" vs "Donate") and the roadmap itself names `bib.sponsor.*` **and** `bib.donate.*`, use **per-variant keys** (`bib.sponsor.amountLabel`, `bib.donate.amountLabel`) rather than one interpolated key — cleaner catalog rows and a 1:1 map to the admin grid. Shared cross-variant strings (e.g. "Payment method") get a single `bib.sponsor.*` or a neutral `bib.checkout.*` key — planner's call.

### Claude's Discretion
- Exact key strings/areas per literal (the `<element>` leaf names) — author during execution against D-05's convention; keep them stable once the snapshot + CMS rows are seeded.
- Prop shape for passing copy into `SponsorInstructions` (whole `copy` map vs pre-resolved strings) — planner's call under D-02.
- Whether "Payment method" / provider-pill labels land under `bib.sponsor.*` vs a neutral `bib.checkout.*` group.
- The import script's exact transport (Strapi REST create loop vs bulk) and where it lives (`scripts/import-copy.ts` alongside `copy:snapshot`).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design (authoritative)
- `docs/superpowers/specs/2026-07-05-cms-copy-catalog-design.md` — the approved milestone design. §"Key naming" (`<namespace>.<area>.<element>`, `bib.sponsor.*`), §"Client-side copy & JavaScript strings" (`t('bib.sponsor.thanksToast', { amount })` pattern), §"Copy Toolkit". **MUST read before planning.**

### Phase 36 toolkit (what this phase consumes — already in run.bib)
- `apps/run.bib/webapp/src/lib/copy.ts` — server-only resolver: `loadCopy(locale)` (cached) + `resolveCopy` + fallback chain (Strapi→S3→snapshot). Server components call `loadCopy('default')`.
- `apps/run.bib/webapp/src/lib/copy-core.ts` — client-safe `t(map, key, vars)` (O(1) lookup) + `interpolate(value, vars)` (`{placeholder}` tokens).
- `apps/run.bib/webapp/src/components/CopyProvider.tsx` — `CopyProvider` (mounted in layout) + `useCopy()` returning bound `t`; client floor `context[key] ?? snapshot[key] ?? key`.
- `apps/run.bib/webapp/src/lib/copy-markdown.tsx` — `renderCopy(value): ReactNode` (escape-first, whitelist bold/italic/link/`\n`, http/https/mailto only) for any copy string that carries formatting.
- `apps/run.bib/webapp/src/lib/copy-snapshot.json` — the committed offline floor; D-01 makes this the authored source of truth for the new keys.
- `apps/run.bib/webapp/src/app/layout.tsx` — reference pattern: `const copy = await loadCopy('default'); t(copy, key)`; `<CopyProvider value={copy}>` already wraps the app.

### Phase 35 foundation (the catalog + import target)
- `apps/run.cms/app/src/api/ui-string/services/copy-export.ts` — S3 export shape the fallback reads: `{ "<locale>": { "<key>": "<value>" } }` at `${REGION_SHORT}/cms/copy.json`; `notes` excluded.
- `.planning/phases/35-cms-copy-catalog-foundation/35-SUMMARY.md` + `35-TESTING-NOTES.md` — `(key,locale)` uniqueness (lifecycle 4xx + DB index); locale always `'default'` in v1; read-only token `run-human-internal` gates find/findOne only → the D-01 import needs a **write-capable** admin token, not the read token.

### Phase 36 context (upstream decisions)
- `.planning/phases/36-runtime-copy-toolkit/36-CONTEXT.md` — D-01 per-app file (not shared package), D-03 revalidate 300s, D-05 minimal markdown renderer, snapshot floor rationale.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Full Phase 36 toolkit is already live in run.bib (see canonical refs): `loadCopy`, `t`, `interpolate`, `useCopy`, `renderCopy`, `CopyProvider`, `copy-snapshot.json`. No new toolkit code — this phase only *consumes* it.
- `layout.tsx` already mounts `<CopyProvider value={copy}>` and demonstrates server `t(copy, 'bib.selftest.serverGreeting')` — the self-test key/marker can be removed or repurposed once real keys render.
- `copy:snapshot` npm script (Phase 36 D-04) — reuse to regenerate the committed snapshot after seeding CMS.

### Established Patterns
- Per-app `src/lib/*.ts` + `scripts/*` convention — the D-01 import script fits as `scripts/import-copy.ts` next to the existing snapshot script.
- Server component reads copy inline (layout.tsx); client component reads via `useCopy()` hook inside handlers (CopyProvider mounted at root, so any client descendant can call it).
- Interpolation already O(1) and shared server/client via `copy-core.interpolate`; `renderCopy` handles inline markdown identically on both sides.

### Integration Points
- **Write path to CMS is new for run.bib.** run.bib's `copy.ts` only *reads* (`CMS_INTERNAL_URL` + read-only `STRAPI_API_TOKEN`). The D-01 import script needs a write-capable Strapi token/endpoint — flag for planner: confirm/provision an admin or write-scoped token for the one-shot import (kept out of runtime env; script/CI only).
- Modals: sponsor confirmation, QR (`social-qr.ts` / QR modal), and logout live in `user-dropdown.tsx` / `menu-dropdown.tsx` — client components; migrate their strings through `useCopy()`.
- Interpolated dynamic values already computed in-component (`displayAmount` via `formatCentsUsd`, `runnerCode`, `providerLabel`) — pass straight into `t(key, { amount, runnerCode, provider })`.
</code_context>

<specifics>
## Specific Ideas

- Interpolation examples to honor verbatim: `Sponsor {amount}` / `Donate {amount}` (SponsorForm CTA), `Pay via {provider}` + `Open {provider}` (SponsorInstructions), `You sponsored {amount}` (confirmation modal, per criterion 2), the post-payment note referencing `{runnerCode}`.
- The SponsorInstructions post-payment note currently wraps `{runnerCode}` in `<code>`. Under D-03 the sentence migrates; keep the `<code>` styling by splitting the string around the interpolated code token, or render via `renderCopy` if editors should control emphasis — planner decides.
- Verification must exercise all four criteria against a real build: render-from-catalog, client-modal interpolation, live CMS edit → reflected wording, and CMS-down fallback (no raw dotted keys).
</specifics>

<deferred>
## Deferred Ideas

- Shared chrome copy (`common.header.*` / `common.profileMenu.*` / `common.footer.*`) unified across apps — Phase 39.
- Remaining non-flow bib copy + other apps (flash/human/auth/gpx) — Phase 39 / v2 (MIGR-02/03/04).
- Custom three-column `label·locale·value` admin plugin — Phase 38.
- Manual `revalidateTag('copy')` instant propagation — out of scope; v1 relies on time-based revalidation (Phase 36 deferred).
- aria-label / accessibility-string catalog coverage — intentionally out (D-03); revisit only if an i18n/a11y phase needs it.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 37-bib-donate-sponsor-proof-surface*
*Context gathered: 2026-07-05*
