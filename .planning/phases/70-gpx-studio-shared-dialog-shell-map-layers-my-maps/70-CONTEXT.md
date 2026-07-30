# Phase 70: gpx-studio Shared Dialog Shell (Map Layers + My Maps) - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/sketches/006-shared-dialog-shell/DESIGN.md — user-approved design contract, Sketch 006 Variant B)

<domain>
## Phase Boundary

Presentation-layer rebuild of two gpx.defcon.run studio surfaces as centered dialogs
sharing one component kit: the Map Layers dialog (replacing the hover-opened
LayerControl popover) and the My Maps dialog (re-hierarchied CloudStorage). Plus a
two-chip clarification in StravaStrip. All layer/data wiring (PublicOverlaysLayer,
MyConRunsLayer, CommunityRoutesLayer, cloud-sync, check-in filter semantics) is
untouched. Delivery is fully autonomous through ship: quality gates → PR →
squash-merge → buildpub.yml → deploy.yml → Playwright prod probe against
https://gpx.defcon.run.
</domain>

<decisions>
## Implementation Decisions

### Shell direction (user-selected via sketch checkpoint)
- BOTH surfaces become centered modal dialogs (user chose over anchored popover / side drawer).
- Section treatment = Sketch 006 **Variant B "Carded sections"**: each section is a raised card (`surface-2`-equivalent bg, 1px border, ~8px radius) inside the dialog body; dialog ~420px wide, body scrolls, max-height ~72vh.

### Shared kit (new components, gpx-studio `lib/components/dialog-shell/`)
- Shell: icon + title (+ optional subtitle) top-left, ✕ top-right, Esc/outside-click close. Reuse the shadcn-svelte Dialog primitives already in `lib/components/ui/` (focus trap, overlay, Esc come free).
- Section: ONE collapse idiom — left chevron rotating ▾ (open) / ▸ (closed), uppercase tracked ~11px label, optional trailing controls in order: count badge, ⋯ menu, master checkbox (rightmost). Master checkbox OFF → section collapses + dims + cascades OFF to child checkboxes; ON → expands (preserves the existing group-off-collapses behavior from PublicOverlays.svelte §9).
- Row: checkbox/radio · 10px color dot (layers) or icon (files) · label · trailing meta/actions.
- Chips: one pill vocabulary — segmented single-select group; multi-select chips tint border/text/bg with the type color when selected.
- Hint bar: fixed one-line strip at the dialog bottom (`ⓘ <hovered/focused row description>`, default "Hover a row for details"). REPLACES all native `title=` tooltips.

### Map Layers dialog
- Opens on CLICK of the layers button. Hover-open (`onmouseenter`/`onmouseleave`/`onpointerenter` + cancelEvents) and the `svelte:window` composedPath outside-click handler are DELETED — shadcn Dialog owns dismissal.
- Section order: BASEMAP (radio rows) → USER CHECK-INS (n) (master toggle in section header; inside: segmented Hour/Today/Whole con, "match a handle…" input, type chips 🐇 Rabbit/★ Admin/⚡ Wildhare/☆ OG with existing colors) → DEF CON 34 ROUTES (master + per-route rows w/ color dots) → RABBIT ROUTES → MY DEF CON RUNS → COMMUNITY ROUTES.
- Empty sections stay hidden (current conditional rendering preserved).
- `quickStartAction` 'routes'/'runners' now open the dialog (they currently set `open = true` on the popover).
- ALL layer-instance lifecycle code in LayerControl.svelte (map.onLoad block, subscriptions, ConDaySaveDialog bridge) is preserved as-is — only the presentation template changes.

### My Maps dialog
- Section order (user decision at sketch checkpoint): **MY FILES first**, then SHARED WITH YOU.
- MY FILES header: count badge + ⋯ menu (New folder / Refresh / Export all) — replaces the floating top-right icon pair.
- File rows: name + meta line; ONE visible labeled **Edit** button + ⋯ menu with labeled items (Share / Assign day / Save as Route / Export GPX / Delete, Delete styled danger + separated) — replaces the five-icon strip. Actions fade in on hover/focus on pointer devices, always visible on touch viewports.
- Footer (user decision): quiet helper text bottom-left + primary **"👟 Add run"** bottom-right. Hint bar sits below the footer.
- SHARED WITH YOU: folder rows with SHARED badge + › affordance, existing navigation behavior unchanged.

### Stutter fixes (both mandatory)
- Delete `title={m.shortDescription}` from PublicOverlays route rows and any equivalent native tooltips in the touched surfaces; descriptions flow to the hint bar (data-hint pattern).
- No hover-open anywhere; the layers control is click-only.

### StravaStrip chips
- Imported-but-untagged card: amber chip becomes explicit actionable "Pick a day".
- Never-imported card: gets a quiet "+ Import" chip.
- Tagged cards unchanged (✓ weekday). Popover modes ('assign'/'import') unchanged.

### Autonomous delivery contract (user requested "fully autonomous delivery")
- Standing authorization FOR THIS PHASE: create PR, squash-merge with `--admin`, run `buildpub.yml -f apps=run.gpx -f regions=use1` (auto-merges the Release PR), then `deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true`, then verify live.
- BEFORE buildpub: check `gh run list --workflow=buildpub.yml` for in-flight run.gpx runs (immutable-ECR-tag race).
- Prod probe: Playwright headless-shell recipe (stub `**/use1/api/gpx/**` + `**/use1/api/user/**` catch-alls FIRST, then `api/gpx/public/**` continue + session + mapbox token from SSM `/dc34/secrets/use1/mapbox/public_token` WITH `--with-decryption`; wait `window._map`; `setTerrain(null)`). Assert: layers button click opens dialog; zero `title` attrs on route rows; My Maps order + footer; hint bar text changes on hover.

### Claude's Discretion
- Exact Tailwind classes / CSS variables for the carded treatment (match the mockup's feel, reuse existing theme tokens where possible; gpx-studio uses Tailwind + shadcn-svelte conventions).
- Whether LayerTree.svelte is reused for basemap radios or replaced by plain Row radios inside the new Section (mockup shows plain radio rows; upstream LayerTree also serves custom-layer settings — do not break LayerControlSettings).
- Component file naming inside `dialog-shell/`.
- How the layers-button CustomControl triggers the dialog (keep CustomControl for map-corner placement; its click handler opens the dialog rendered outside the control).
- Menu positioning/overflow handling inside the scrollable dialog body.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contract (authoritative)
- `.planning/sketches/006-shared-dialog-shell/DESIGN.md` — the approved design decisions
- `.planning/sketches/006-shared-dialog-shell/index.html` — winning mockup (Variant B ★); exact section/row/chip/hint-bar behavior reference
- `.planning/sketches/006-shared-dialog-shell/README.md` — design question + what was compared

### Source to modify (all under `apps/run.gpx/gpx-studio/website/src/`)
- `lib/components/map/layer-control/LayerControl.svelte` — popover → dialog host; PRESERVE all layer lifecycle wiring
- `lib/components/map/layer-control/PublicOverlays.svelte` — check-ins block + route groups; source of the `title=` tooltips and the master-collapse behavior to preserve
- `lib/components/map/layer-control/MyConRuns.svelte`, `CommunityRoutes.svelte`, `LayerTree.svelte` — sections to re-skin
- `lib/components/cloud/CloudStorage.svelte` — My Maps dialog (verify actual path with Glob before editing)
- `lib/components/StravaStrip.svelte` — chip labels (isTagged/isUntaggedImport at lines ~192-198)
- `lib/components/ui/` — existing shadcn-svelte primitives (Dialog, ScrollArea, Separator, DropdownMenu if present)
- `routes/[[language]]/app/+page.svelte` — CustomControl mount order (SpotControl → LayerControl)

### Project rules
- `AGENTS.md` — deploy ONLY via GitHub Actions; branch workflow; simplicity-first
- `apps/run.gpx/build-frontend.sh` — the ONLY way to install gpx-studio deps / build the frontend
</canonical_refs>

<specifics>
## Specific Ideas

- Mockup data-hint → hint bar pattern is the reference implementation for the tooltip replacement (see index.html `mouseover` delegation).
- Master-checkbox cascade + collapse semantics are demonstrated live in the mockup (`change` delegation).
- svelte-check baseline has ~26-30 PRE-EXISTING upstream errors — quality gate is ZERO NEW errors on touched files, not zero total.
- Node 22.12 (`nvm use 22.12.0`) for webapp vitest; gpx-studio deps only via `./build-frontend.sh`.
- Bundle-grep verification: string literals and CSS classes survive minification; function names don't.
</specifics>

<deferred>
## Deferred Ideas

- Mobile FAB / small-viewport dialog ergonomics beyond what the shared Dialog gives free (existing mobile menu untouched).
- My Maps folder navigation internals and any cloud-sync changes.
- Check-in filter semantics changes (window/match/types stay exactly as shipped).
- cac1 release (use1 only, matching current gpx release practice).
</deferred>

---

*Phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps*
*Context gathered: 2026-07-29 via PRD Express Path*
