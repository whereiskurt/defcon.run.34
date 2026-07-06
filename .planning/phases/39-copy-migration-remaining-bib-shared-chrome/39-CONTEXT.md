# Phase 39: Copy Migration — Remaining Bib + Shared Chrome - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate the **rest of run.bib's copy** and the **shared header/profile-menu/footer chrome** onto CMS catalog keys, and — the ambitious call this phase — **prove the copy-paste de-dup win LIVE** by installing the Phase 36 toolkit into **run.human** and pointing its chrome at the *same* `common.*` keys. Editing one `common.*` row in the CMS then changes the wording in **both** run.bib and run.human with no shared React component and no deploy (SC-3, demonstrated — not latent).

Words-only scope: each app keeps its own React header/menu/footer components and reads labels by shared key. No shared component rewrite.

**Requirements:** MIGR-02 (remaining `run.bib` copy) + MIGR-03 (shared chrome under `common.header.*` / `common.profileMenu.*`, every reading app resolves the same keys).

**In scope (Phase 39):**

*run.bib — remaining copy (MIGR-02, full sweep per D-04):*
- `components/TransactionHistory.tsx` — remaining bib transaction/history prose (37 explicitly deferred here).
- `components/AdminActions.tsx` — admin-surface prose (37 deferred here).
- The **non-trigger** chrome that 37 left literal: `components/header.tsx` (nav labels + wordmark + any Admin/Sign-in prose beyond the `bib.donate.trigger` key 37 already migrated), `components/menu-dropdown.tsx` (mobile nav items), `components/user-dropdown.tsx` (the full profile menu — Profile / My Bib / CMS / Admin reports / GPS Check-in / Show My QR / Sign out), `components/footer.tsx`.
- A sweep of remaining bib surfaces for stray user-facing literals so SC-1 ("no inline string literals left on migrated surfaces") actually holds (empty/loading/error prose, page headings). Aria-labels + error DETAIL tokens stay literal (carries 37 D-03).

*Shared chrome under `common.*` (MIGR-03) — bib + run.human, LIVE:*
- **run.bib** chrome (above) reads `common.header.*` / `common.profileMenu.*` / `common.footer.*`.
- **run.human**: install the toolkit (port from run.bib — D-05) and wire its chrome (`components/header/header.tsx`, `components/header/dropdown-user.tsx`, `components/footer.tsx`) to the **same** `common.*` keys.
- **ALL chrome under `common.*`** (D-03): header nav + profile menu + footer all keyed `common.header.*` / `common.profileMenu.*` / `common.footer.*`, regardless of whether every individual label is literally shared across every app today. Single unified chrome namespace.

*run.human — opportunistic easy wins (D-06):*
- Beyond chrome, catalog *clearly-static, low-risk* run.human visible prose under the `human.*` namespace **at planner discretion**, guardrailed below.

**Explicitly OUT of scope (→ MIGR-04 / v2 unless noted):**
- **run.auth, run.gpx, run.flash** chrome/copy migration. run.gpx is Svelte (`t()` React toolkit does not apply) — hard-out. run.auth deferred to MIGR-04.
- run.human's **complex/deep** surfaces: CheckInModal, dashboard internals, profile map/history, QR modal, anything interpolation-heavy or bound to deep client state — MIGR-04. The `human.*` "easy wins" are a bounded opportunistic add, NOT a run.human overhaul.
- Extracting a shared toolkit **package** (rejected — D-05; copy-paste port instead).
- Any `ui-string` schema change — `common` and `human` are already in the Phase 35 namespace enum.
- Manual `revalidateTag('copy')` instant propagation — v1 rides time-based revalidation.

**Success criteria (from ROADMAP, locked):**
1. Remaining `run.bib` copy (beyond donate/sponsor) resolves from catalog keys, no inline string literals left on migrated surfaces.
2. Shared chrome copy is keyed under `common.header.*` / `common.profileMenu.*`, and each reading app (bib + run.human this phase) renders those labels through `t()` from the same keys.
3. Editing a `common.*` key changes the wording in every app that reads it (bib **and** run.human, live) — the de-dup win — with no shared React component change and no deploy.
</domain>

<decisions>
## Implementation Decisions

### App scope of MIGR-03 (the pivotal call)
- **D-01:** **Bib + wire run.human LIVE.** run.bib chrome + remaining bib prose migrate to catalog keys; **run.human also gets the toolkit installed and its chrome pointed at the same `common.*` keys**, so a single CMS edit changes wording in BOTH apps this phase. This makes SC-3's de-dup win *demonstrated*, not latent. run.auth deferred to MIGR-04; run.gpx (Svelte) hard-out. Chosen over the smaller "bib-only, establish `common.*` as sole reader" option — the user wants the payoff proven live.

### Chrome namespace boundary
- **D-02:** **Footer is IN** — migrate footer copy as `common.footer.*` (37 deferred footer here). The bib/human footer is minimal (`defcon.run 34` wordmark + version tooltip); whether the wordmark itself (a brand token) migrates vs. only version-adjacent copy is planner discretion — but the footer is in-scope, not skipped.
- **D-03:** **ALL chrome under `common.*`.** Header nav (`Maps` / `Meshtastic` / `Bib`), profile menu, and footer all key under `common.header.*` / `common.profileMenu.*` / `common.footer.*`, even labels that aren't literally shared across every app today. Single unified chrome namespace over a split `common.*` (shared) vs `bib.*` (app-specific nav) scheme — simpler namespace, and these nav items ARE byte-identical between bib and run.human today anyway.

### Bib remaining-copy sweep
- **D-04:** **Full sweep.** Migrate TransactionHistory + AdminActions prose AND sweep remaining bib surfaces for stray user-facing literals (empty/loading/error states, page headings) so SC-1 ("no inline string literals left on migrated surfaces") genuinely holds. Aria-labels and error DETAIL/interpolation tokens (`{detail}`, `HTTP 500`, "network") stay literal — carries 37 D-03 unchanged.

### run.human toolkit install
- **D-05:** **Copy-paste port the toolkit into run.human**, matching the repo's per-app copy convention (bib's DonateModal is already byte-copied into human/flash; no shared package). Port the 5 toolkit files from run.bib — `lib/copy.ts`, `lib/copy-core.ts`, `lib/copy-markdown.tsx`, `components/CopyProvider.tsx`, `lib/copy-snapshot.json` — into run.human, and mount `<CopyProvider>` in run.human's chrome. **Rejected:** extracting a shared workspace package (new build/package wiring the monorepo doesn't use; against convention + "simplicity first"). The accepted cost is two divergent toolkit copies — same tradeoff the codebase already lives with.
  - **run.human de-risk (verified):** run.human ALREADY has `config.cms.internalUrl` (`CMS_INTERNAL_URL`) + `config.cms.apiToken` (`STRAPI_API_TOKEN`) in `src/config/index.ts` — the exact env the bib toolkit reads. The read path is largely a copy job. Confirm the ported `copy.ts` reads the same env names (it references `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN` directly today).
  - **Mount point:** run.human has **NO root layout** — it has route-group layouts `src/app/(protected)/layout.tsx` and `src/app/(public)/layout.tsx`, and the header renders in both. `CopyProvider` must wrap both (a shared wrapper the two group layouts import, or mount in each). Planner's call on mechanism.

### run.human scope fence
- **D-06:** **Chrome + opportunistic easy run.human wins.** run.human's shared chrome (header / dropdown-user / footer) reads `common.*`. Beyond that, the planner MAY catalog additional *clearly-static, low-risk, visible* run.human prose under the `human.*` namespace while the toolkit is being installed. **Guardrail:** "easy wins" = static top-level page headings / simple nav-adjacent labels with no interpolation and no deep client-state coupling. Anything interpolation-heavy or bound to complex components (CheckInModal, dashboard, profile map/history, QR) stays **MIGR-04** — do not blur the MIGR-03/MIGR-04 line into a run.human overhaul. When in doubt, defer.

### Seeding & source of truth (carries 37 D-01, extended)
- **D-07:** Author each app's committed `copy-snapshot.json` as source of truth for its migrated keys, then one-shot import the same `(key, locale='default', value, namespace)` rows into the single shared Strapi catalog via a **write-capable** token (NOT the runtime read-only token; operator-supplied at import time, never in runtime env / committed source). **Both** run.bib's and run.human's snapshots MUST include the full `common.*` subset — each app carries its own offline floor for the shared chrome keys (the server `t` has no floor of its own; SC-4-style fallback must render from the snapshot `default` map, not `{}`).

### Carried forward from Phase 37 / 36 (locked, not re-discussed)
- Toolkit consumption: server components use `loadCopy('default')` + `t(copy, key)` / `renderCopy`; client components use `useCopy()`; O(1) `{placeholder}` interpolation shared server/client via `copy-core`.
- Copy scope rule (37 D-03): visible labels + sentences + CTAs + interpolated/modal copy migrate; aria-labels + dev/error DETAIL tokens stay literal.
- Key naming (37 D-05): `<namespace>.<area>.<element>`; per-variant keys where words differ; de-dupe identical strings to one shared key referenced from every site.

### Claude's Discretion
- Exact leaf key names per literal (author during execution against the naming convention; keep stable once seeded).
- Where the run.human `human.*` "easy wins" boundary sits — planner judgment under the D-06 guardrail (bias to defer).
- `CopyProvider` mount mechanics across run.human's two group layouts (shared wrapper vs. mount in each).
- Whether the footer wordmark `defcon.run 34` (brand token) migrates or only version-adjacent copy (D-02).
- Wave split — ROADMAP hints "parallel waves per surface" (e.g. bib-remaining / common-chrome-bib / common-chrome-human / human-easy-wins). Planner decides wave shape + dependency edges (toolkit-port-into-human gates human chrome wiring).
- Whether `bib.donate.trigger` (37 D-07) is re-homed to `common.header.*` now that all chrome unifies under `common.*`, or left as-is — planner's call; if moved, keep the old key seeded or migrate both apps' references.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design (authoritative)
- `docs/superpowers/specs/2026-07-05-cms-copy-catalog-design.md` — §"Key naming" (`<namespace>.<area>.<element>`, `common.*`), §"Copy Toolkit", §"Client-side copy & JavaScript strings", §"Cross-cutting string migration" (words-only, per-app header reads shared key). **MUST read before planning.**

### Prior-phase context (the pattern this phase extends)
- `.planning/phases/37-bib-donate-sponsor-proof-surface/37-CONTEXT.md` — the proof-surface migration this continues; D-01 (seeding/write-token), D-03 (copy scope), D-05 (key naming), D-07 (`bib.donate.trigger` chrome seam), D-09 (de-dup shared keys). **MUST read** — Phase 39 is its second act.
- `.planning/phases/36-runtime-copy-toolkit/36-CONTEXT.md` — toolkit design + fallback chain.
- `.planning/phases/35-cms-copy-catalog-foundation/35-CONTEXT.md` — namespace enum `[common,human,auth,gpx,bib,flash]` (no schema change needed), locale always `default`, S3 export shape.

### Toolkit source (port target — copy from run.bib into run.human, D-05)
- `apps/run.bib/webapp/src/lib/copy.ts` — server-only `loadCopy(locale)` (cached, 3-layer fallback: Strapi → S3 `copy.json` → committed snapshot); reads `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN`.
- `apps/run.bib/webapp/src/lib/copy-core.ts` — client-safe `t(map, key, vars)` + `interpolate`.
- `apps/run.bib/webapp/src/lib/copy-markdown.tsx` — `renderCopy(value)` (escape-first whitelist).
- `apps/run.bib/webapp/src/components/CopyProvider.tsx` — `CopyProvider` + `useCopy()`.
- `apps/run.bib/webapp/src/lib/copy-snapshot.json` — committed offline floor (D-07 source of truth).
- `apps/run.bib/webapp/src/app/layout.tsx` — reference server pattern + `<CopyProvider value={copy}>` mount.

### run.bib surfaces to migrate (MIGR-02 + common chrome)
- `apps/run.bib/webapp/src/components/TransactionHistory.tsx`, `components/AdminActions.tsx` (37-deferred remaining prose).
- `apps/run.bib/webapp/src/components/header.tsx`, `components/menu-dropdown.tsx`, `components/user-dropdown.tsx`, `components/footer.tsx` (chrome → `common.*`).

### run.human targets (install toolkit + wire chrome to common.*)
- `apps/run.human/webapp/src/config/index.ts` — `config.cms.internalUrl` / `config.cms.apiToken` already present (reuse; verify env names match ported `copy.ts`).
- `apps/run.human/webapp/src/app/(protected)/layout.tsx` + `src/app/(public)/layout.tsx` — CopyProvider mount points (NO root layout).
- `apps/run.human/webapp/src/components/header/header.tsx`, `components/header/dropdown-user.tsx`, `components/footer.tsx` — chrome → same `common.*` keys as bib.

### CMS catalog (import target — reuse, do not rebuild)
- `apps/run.cms/app/src/api/ui-string/services/copy-export.ts` — S3 export shape.
- `.planning/phases/35-cms-copy-catalog-foundation/35-SUMMARY.md` + `35-TESTING-NOTES.md` — read-only vs write token; D-07 import needs a **write** token.

### Requirements
- `.planning/REQUIREMENTS.md` — MIGR-02, MIGR-03 exact text (+ MIGR-04 v2 line that scopes what stays deferred).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Full Phase 36 toolkit already live in run.bib (5 files above) — Phase 39 ports it into run.human verbatim; no new toolkit code authored.
- run.human already fetches Strapi content and carries `CMS_INTERNAL_URL` + `STRAPI_API_TOKEN` config — the toolkit read path plugs into existing infra, not new wiring.
- The profile menu is genuinely copy-pasted: `run.bib/user-dropdown.tsx` and `run.human/header/dropdown-user.tsx` share `Profile / My Bib / CMS / Admin / GPS Check-in / Show My QR / Sign out` — the real de-dup target that makes SC-3 demonstrable.
- Header nav (`Maps` / `Meshtastic` / `Bib`) is byte-identical between the two apps' headers today → clean `common.header.*` unification.

### Established Patterns
- Server component reads copy inline via `loadCopy`+`t`; client component via `useCopy()` (provider mounted at root/layout). run.bib's `layout.tsx` is the reference.
- Interpolation O(1), shared server/client via `copy-core.interpolate`; `renderCopy` handles inline markdown identically both sides.
- Per-app copy-paste is the repo norm (no shared package) — the D-05 port matches it.

### Integration Points
- **run.human has no root layout** — CopyProvider must wrap BOTH `(protected)` and `(public)` group layouts (shared wrapper or mount in each). Header renders in both trees.
- **Single shared CMS catalog, per-app snapshot floor** — both apps import the `common.*` subset into their own `copy-snapshot.json` (offline floor); the CMS holds one authoritative copy of each `common.*` row that both apps read live.
- **Write path to CMS** is import-time only (D-07 write token, operator-supplied); runtime stays read-only in both apps.
- **Wave dependency:** porting the toolkit into run.human gates wiring run.human's chrome; authoring `common.*` keys gates both apps' chrome referencing them.
</code_context>

<specifics>
## Specific Ideas

- The demonstrable payoff to verify: edit one `common.profileMenu.signOut` (or similar) row in the CMS → the label changes in BOTH `bib.defcon.run` and `run.defcon.run` within the propagation window, with no deploy and no shared component touched. This is SC-3 made real and is the phase's headline proof.
- Verification must exercise, against a real build: (1) bib remaining copy renders from catalog keys, no raw dotted keys; (2) run.human chrome renders from `common.*` keys; (3) a live CMS `common.*` edit reflected in BOTH apps; (4) CMS-down fallback in both apps renders from each app's snapshot `default` map (NOT `{}`) — never a raw dotted key.
- run.human "easy wins" (D-06) go under `human.*`, kept small and static — do not let them balloon run.human's review surface.

</specifics>

<deferred>
## Deferred Ideas

- **run.auth, run.flash, run.gpx** chrome/copy migration + toolkit adoption — MIGR-04 / v2. (run.gpx Svelte = permanent-out for the React toolkit.)
- run.human's complex surfaces (CheckInModal, dashboard, profile map/history, QR) — MIGR-04.
- Other apps' `DonateModal` copies (run.human, run.flash) — MIGR-04 / v2 (per 37 D-09 caveat).
- Extracting a shared toolkit package to end per-app divergence — deliberately rejected this phase (D-05); revisit if divergence ever bites.
- Manual `revalidateTag('copy')` instant propagation — out; v1 rides time-based revalidation.
- aria-label / a11y-string catalog coverage — intentionally out (37 D-03).
- Per-locale authoring beyond `default` — whole-milestone YAGNI (schema is ready).

### Reviewed Todos (not folded)
None — no pending todos matched this phase.

</deferred>

---

*Phase: 39-copy-migration-remaining-bib-shared-chrome*
*Context gathered: 2026-07-06*
