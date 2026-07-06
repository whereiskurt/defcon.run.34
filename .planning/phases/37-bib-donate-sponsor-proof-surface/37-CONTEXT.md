# Phase 37: Bib Donate/Sponsor Proof Surface - Context

**Gathered:** 2026-07-05
**Re-scoped:** 2026-07-06 — after rebasing onto `origin/main` (branch was 97 commits stale). The donate/sponsor surface was substantially reworked in v1.8 (Phase 34); the original CONTEXT/plans targeted a stale surface. This revision reflects the ACTUAL current components. Approach decisions D-01…D-05 are unchanged; the surface/scope (D-06…D-09) is corrected.
**Status:** Ready for (re-)planning

<domain>
## Phase Boundary

Wire the **bib donate/sponsor surface** to read all of its copy from the catalog end-to-end — the primary motivating surface and the deliberately hardest case (client-side, interpolated, modal-heavy) — proving the Phase 36 toolkit before the broader Phase 39 migration. Replace inline JSX copy literals with catalog-resolved keys via the existing toolkit: `t(copy, key)` / `renderCopy` on server components, `useCopy()` in client components, `{placeholder}` interpolation for dynamic strings.

**Requirements:** MIGR-01.

**In-scope surfaces (re-scoped against current main — ~80 keys). Mechanism noted per file:**

*Contribution / donate cluster (the v1.8 rework — this IS the current live donate surface):*
- `components/DonateModal.tsx` (**client** → `useCopy()`) — "Just donate" quick-give overlay: title, subhead, amount label, slider helper (interp `{min}/{max}`), "Payment method", provider pills (Card/Cash App/Venmo), the organizer-confirm note, submit `Donate {amount}` / "Redirecting…", error sentence.
- `components/ContributionTiles.tsx` (**client**) — Sponsor/Donate tile titles + bodies + kicker eyebrows ("Support"/"This"/"or That") + the `ctaLabel` values ("Donate"/"Sponsor") passed to SponsorForm.
- `components/ContributionChoice.tsx` (**client**) — pledge/burn control: in-person checkbox, "🔥 Fuck that bib…" burn label, the three hint lines, the 30-rain limit note, error sentence.
- `components/ContributionChip.tsx` (**server** → `loadCopy`+`t`) — "Thank you" pill + its interpolated aria.
- `components/StripeStatusBanner.tsx` (**client**) — payment success + cancel banner copy (SC-2 confirmation surface).
- `components/PledgeTagline.tsx` (**client**) — "OK! You promised 🙏".
- `components/BurningBib.tsx` (**server**) — the `alt` text "Your bib is a dumpster fire."

*Sponsor forms + instructions:*
- `components/SponsorForm.tsx` (**client**) — per-variant amount labels ("Sponsor amount"/"Donation amount"), slider helper, "Payment method", provider pills, organizer-confirm note (shared with DonateModal), submit `{ctaLabel} {amount}` ("Sponsor"/"Donate" defaults) / "Redirecting…", error sentence.
- `components/SponsorInstructions.tsx` (**server**) — "Pay via {provider}", "Send to", "Required comment" + hint, "Open {provider}", the closing note referencing `<code>{runnerCode}</code>`.
- `app/sponsor/venmo/page.tsx` + `app/sponsor/cashapp/page.tsx` (**server**) — h1, subhead, "← Back to bib".

*Bib name-entry proof (D-04):*
- `components/BibForm.tsx` (**client**) — Save/"Verifying…"/"Saving…"/"Cancel", the locked-name hint, error sentence, `placeholder="1337"` (borderline design token — planner's call).
- `components/BibPreview.tsx` (**server**) — the rubber-stamp copy "UNSAVED"/"DRAFT"/"PAID!"/"THANK YOU!" (D-08).
- `components/RunnerCodeBadge.tsx` (**client**) — "Runner code" eyebrow, "Copy"/"Copied!".

*Landing shell + donate trigger:*
- `app/orderform/page.tsx` (**server**) — h1 "Bibs & Donation" + the intro paragraph.
- `components/header.tsx` + `components/menu-dropdown.tsx` (**client**) — ONLY the `"Donate $"` trigger label → `bib.donate.trigger` (D-07). The rest of those files' chrome stays literal for Phase 39.
- `components/payment-icons.tsx` (**server**) — aria-only brand names; trivial/optional (planner may leave as brand constants).

**Explicitly NOT this phase (→ Phase 39 unless noted):**
- Shared chrome: the rest of `header.tsx` (nav labels, wordmark, Admin), `footer.tsx`, the full `user-dropdown.tsx` profile menu (Profile/My Bib/CMS/Admin reports/GPS Check-in/Show My QR/Sign out), and `menu-dropdown.tsx`'s non-trigger nav items — all become `common.header.*` / `common.profileMenu.*` / `common.footer.*` in Phase 39.
- `components/TransactionHistory.tsx` (remaining bib copy; not on the current orderform — the chip replaced it) and `components/AdminActions.tsx` (admin surface) → Phase 39.
- Per D-03: aria-labels and error DETAIL tokens (`{detail}`, `HTTP 500`, "network") stay literal. The user-facing error SENTENCE migrates; the interpolated token stays raw.
- Other apps' copies of `DonateModal` (run.human, run.flash) → deferred MIGR-04 / v2. See D-09 caveat.
- Custom admin plugin → Phase 38.

**Success criteria (from ROADMAP, locked):**
1. The donate/sponsor copy renders from `bib.*` catalog keys instead of inline JSX literals.
2. The donate/sponsor modals + their interpolated strings (e.g. `Donate {amount}`, `Sponsor {amount}`, the Stripe status banner, the ContributionChip thank-you) resolve through `useCopy()` (client) / `t()` (server) inside handlers/render.
3. Editing a bib donate/sponsor string in the CMS changes the rendered wording within the propagation window with no deploy.
4. With the CMS unavailable, the copy still renders via the fallback chain — never a raw dotted key.
</domain>

<decisions>
## Implementation Decisions

### Seeding & source of truth (satisfies SC-3 + SC-4)
- **D-01:** Author the committed `copy-snapshot.json` as source of truth for every migrated key, then a one-shot import script POSTs the same `(key, locale='default', value, namespace='bib')` rows into Strapi via a **write-capable** token (NOT the runtime read-only `STRAPI_API_TOKEN`). Satisfies fallback-proof (SC-4, snapshot present) + edit-proof (SC-3, live CMS row) in one authoring pass. Import needs a write token supplied at script/CI/manual time only — never in runtime env or committed source. Verify round-trip via `copy:snapshot`. **(Operator has supplied a time-limited write token for this run.)**

### Server-component copy access
- **D-02:** Server components/pages call the cached `loadCopy('default')` directly and use `t(copy, key)` / `renderCopy(t(copy, key))` — mirrors `layout.tsx`. `loadCopy` is `unstable_cache`-wrapped so repeat calls are O(1). Applies to the server files above: SponsorInstructions, ContributionChip, BibPreview, BurningBib, orderform page, venmo/cashapp pages.

### Copy scope (what migrates)
- **D-03:** Visible labels + sentences + CTAs + interpolated strings + modal copy migrate. aria-labels and dev/error DETAIL tokens stay literal. The user-facing error SENTENCE migrates; the interpolated `{detail}` token stays raw.

### 37 ↔ 39 boundary
- **D-04:** BibForm/GetYourBib name-entry copy is IN this phase (full donate/sponsor vertical proof). GetYourBib is a thin wrapper with no copy — its copy lives in BibForm.

### Key naming (design doc + roadmap)
- **D-05:** Keys follow `<namespace>.<area>.<element>` (namespace `bib`). Per-variant keys where words differ (`bib.sponsor.amountLabel` vs `bib.donate.amountLabel`). Key-area groups (from the surface inventory): `bib.donate.*`, `bib.sponsor.*`, `bib.contribution.*`, `bib.bibform.*`, `bib.instructions.*`, `bib.status.*`, `bib.landing.*`, plus a shared `bib.checkout.*` (or `bib.common.*`) group for de-duped cross-component strings.

### Re-scope against current main (2026-07-06)
- **D-06:** The donate/sponsor surface was reworked in v1.8 (Phase 34) — the **contribution/donate cluster** (`DonateModal`, `ContributionChoice`, `ContributionTiles`, `ContributionChip`, `StripeStatusBanner`, `PledgeTagline`, `BurningBib`) IS the current live donate surface (it replaced the old TransactionHistory panel + separate banner). It is fully IN-37. Total 37 magnitude ≈ **80 keys** (~65 prose + ~15 aria-mirroring); whole catalog ≈110, with ~30 chrome/admin/history deferred to 39.
- **D-07:** The `"Donate $"` trigger label (in `header.tsx` desktop + `menu-dropdown.tsx` mobile) migrates as **`bib.donate.trigger`**, referenced from both chrome files — the ONLY chrome strings 37 touches. The remaining chrome in those two files stays literal for Phase 39 (a documented, accepted seam — 37 touches header.tsx/menu-dropdown.tsx for one key each and nothing else).
- **D-08:** `BibPreview.tsx` rubber-stamp copy (`UNSAVED`/`DRAFT`/`PAID!`/`THANK YOU!`) is IN-37 — it's part of the bib proof and BibForm renders it. (Not in the original file list; added here.)
- **D-09:** De-dupe identical strings to single shared keys, referenced from every site: e.g. the organizer-confirm provider note (DonateModal + SponsorForm), the "Slide or type any amount from ${min} up to ${max}" helper, "Payment method", the Card/Cash App/Venmo pill labels, "Redirecting…", and the "Could not start checkout (…) — try again." error sentence. Shared keys live under `bib.checkout.*` (planner's exact grouping). **Caveat:** `DonateModal.tsx` is currently byte-for-byte duplicated into run.human and run.flash; migrating run.bib's copy will diverge run.bib's DonateModal from the other two. That is expected (other apps = deferred MIGR-04/v2) — do NOT re-sync those three files byte-for-byte after this phase; the CMS catalog becomes run.bib's source. Note this in the plan.

### Claude's Discretion
- Exact key leaf names per literal (author during execution against D-05); keep stable once seeded.
- Whether `bib.checkout.*` vs `bib.common.*` hosts the de-duped shared strings (D-09).
- Whether the BibForm `placeholder="1337"` and BibPreview `PRIMARY_PLACEHOLDER` (a rendered graphic token) migrate or stay as design constants.
- Prop shape for passing `copy` into server children (whole map vs pre-resolved strings) under D-02.
- Whether `payment-icons` aria brand names migrate or stay brand constants (trivial).
- Import script transport + location (`scripts/import-copy.mjs` alongside the existing `copy-snapshot.mjs`; `.mjs` to avoid a tsx dependency — repo no-new-deps rule).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design (authoritative)
- `docs/superpowers/specs/2026-07-05-cms-copy-catalog-design.md` — §"Key naming" (`<namespace>.<area>.<element>`, `bib.sponsor.*`), §"Client-side copy & JavaScript strings" (`t('bib.sponsor.thanksToast', { amount })` pattern), §"Copy Toolkit". **MUST read before planning.**

### Phase 36 toolkit (consumed — already in run.bib, on main)
- `apps/run.bib/webapp/src/lib/copy.ts` — server-only `loadCopy(locale)` (cached) + fallback chain.
- `apps/run.bib/webapp/src/lib/copy-core.ts` — client-safe `t(map, key, vars)` (O(1)) + `interpolate`.
- `apps/run.bib/webapp/src/components/CopyProvider.tsx` — `CopyProvider` (mounted in layout) + `useCopy()`.
- `apps/run.bib/webapp/src/lib/copy-markdown.tsx` — `renderCopy(value): ReactNode` (escape-first, whitelist bold/italic/link/`\n`).
- `apps/run.bib/webapp/src/lib/copy-snapshot.json` — committed offline floor; D-01 makes this the authored source of truth.
- `apps/run.bib/webapp/src/app/layout.tsx` — reference server pattern; `<CopyProvider value={copy}>` already wraps the app (self-test key `bib.selftest.serverGreeting` may be repurposed/removed).

### Phase 35 foundation (catalog + import target)
- `apps/run.cms/app/src/api/ui-string/services/copy-export.ts` — S3 export shape; `notes` excluded.
- `.planning/phases/35-cms-copy-catalog-foundation/35-SUMMARY.md` + `35-TESTING-NOTES.md` — locale always `'default'`; read-only token `run-human-internal` gates find/findOne only → the D-01 import needs a **write** token.

### Surface inventory (this re-scope)
- Current donate/sponsor components enumerated in `<domain>` above, read against rebased HEAD. Client/server split there drives `useCopy()` vs `loadCopy`+`t`.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Full Phase 36 toolkit already live in run.bib (see canonical refs) — no new toolkit code; 37 only consumes it.
- `layout.tsx` mounts `<CopyProvider value={copy}>` and demonstrates server `t(copy, key)`.
- `copy-snapshot.mjs` (Phase 36) — reuse to regenerate the snapshot; `import-copy.mjs` fits alongside.

### Established Patterns
- Server component reads copy inline via `loadCopy`+`t`; client component reads via `useCopy()` (provider mounted at root).
- Interpolation O(1), shared server/client via `copy-core.interpolate`; `renderCopy` handles inline markdown identically both sides.
- Dynamic values already computed in-component (`displayAmount`, `runnerCode`, `providerLabel`, `amount`) — pass straight into `t(key, { amount, runnerCode, provider })`.

### Integration Points
- **Write path to CMS is new for run.bib.** run.bib's `copy.ts` only reads (read-only token). The D-01 import script needs a write-capable token (operator-supplied for this run; kept out of runtime env / committed source).
- Client modals resolving via `useCopy()` inside handlers/render: DonateModal, ContributionChoice, ContributionTiles, StripeStatusBanner, PledgeTagline, SponsorForm, BibForm, RunnerCodeBadge.
- Server surfaces resolving via `loadCopy`+`t`: SponsorInstructions, ContributionChip, BibPreview, BurningBib, orderform page, venmo/cashapp pages.
- `header.tsx` + `menu-dropdown.tsx`: touch ONLY the `"Donate $"` label (D-07); leave the rest.
</code_context>

<specifics>
## Specific Ideas

- Interpolation examples to honor verbatim: `Donate {amount}` / `Sponsor {amount}` (DonateModal/SponsorForm CTAs), `Pay via {provider}` + `Open {provider}` (SponsorInstructions), the ContributionChip aria "…contributed {amount} via {provs}", the SponsorInstructions closing note referencing `{runnerCode}`.
- The SponsorInstructions closing note wraps `{runnerCode}` in `<code>` — split the string around the interpolated token (or `renderCopy`) so the `<code>` treatment survives; planner decides.
- De-dupe: several strings appear in both DonateModal and SponsorForm (provider note, "Payment method", pill labels, "Redirecting…", error sentence) — one shared key each (D-09).
- Verification must exercise all four criteria against a real build: catalog render, client-modal interpolation, live CMS edit → reflected wording (using the operator's write token), and CMS-down fallback (no raw dotted keys). The SC-4 server-floor test must render with the snapshot `default` map (the CMS-down `loadCopy` output), NOT `{}` — the server `t` has no floor of its own.
</specifics>

<deferred>
## Deferred Ideas

- Shared chrome copy (`common.header.*` / `common.profileMenu.*` / `common.footer.*`) — Phase 39. Includes the full user-dropdown profile menu, footer, and header/menu-dropdown chrome EXCEPT the `bib.donate.trigger` label (D-07).
- `TransactionHistory.tsx` + `AdminActions.tsx` copy — Phase 39 (remaining bib / admin).
- Other apps' `DonateModal` (run.human, run.flash) + flash/human/auth/gpx migration — deferred MIGR-04 / v2.
- Custom three-column admin plugin — Phase 38.
- Manual `revalidateTag('copy')` instant propagation — out of scope; v1 relies on time-based revalidation.
- aria-label / a11y-string catalog coverage — intentionally out (D-03).

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 37-bib-donate-sponsor-proof-surface*
*Context gathered: 2026-07-05 · Re-scoped against current main: 2026-07-06*
