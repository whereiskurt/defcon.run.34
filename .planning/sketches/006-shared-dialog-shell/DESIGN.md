# Design: Shared Dialog Shell — Map Layers + My Maps (gpx-studio)

**Date:** 2026-07-29 · **Status:** approved direction (Sketch 006, Variant B "Carded sections")
**Mockup:** `index.html` in this directory (winner tab marked ★)

## Problem

Three complaints against the current gpx.defcon.run studio UI (screenshots 2026-07-29):

1. The layers hover-panel reads as "Basemaps" (the first tree's node label masquerades as
   a panel title) and stacks four unlabeled sections with **three different collapse
   affordances** (right-chevron tree, left-chevron group buttons, checkbox-reveals-content).
2. The My Maps dialog has cryptic icon-only row actions, muddled hierarchy (shared folders
   vs OTHER MAPS vs floating new-folder/refresh icons), and bolted-on footer actions.
3. Mouse-over the route list **stutters**: native `title=` tooltips (PublicOverlays.svelte
   route rows) pop over the list, and the panel opens/closes on raw mouseenter/mouseleave.

## Decision

Both surfaces become **centered dialogs sharing one shell** (user-picked over anchored
popover and side-drawer options), with section internals in the **Carded** treatment:
each section is a raised card (`surface-2`, 1px border, 8px radius) inside the dialog body.

### Shared kit (new, in gpx-studio `lib/components/dialog-shell/`)

- **Shell** — dark card, icon + title (+ optional subtitle) top-left, ✕ top-right,
  Esc/outside-click closes. Max width ~420px, body scrolls, max-height ~72vh.
- **Section** — ONE collapse idiom everywhere: left chevron (▾ open / ▸ closed, rotates),
  uppercase tracked 11px label, optional trailing controls (count badge, ⋯ menu, master
  checkbox rightmost). Master checkbox OFF → section collapses + dims (preserves today's
  group-off-collapses behavior); ON → expands. Cascades to child checkboxes.
- **Row** — checkbox/radio · 10px color dot (layers) or icon (files) · label · trailing.
- **Chips** — one pill vocabulary: segmented single-select group + multi-select chips
  (selected multi-chips tint border/text/bg with the type color).
- **Hint bar** — fixed strip at dialog bottom: `ⓘ <description of hovered/focused row>`.
  **Replaces all native `title=` tooltips** — nothing floats, nothing reflows (stutter fix #1).

### Map Layers dialog (replaces the LayerControl hover popover)

- Opens on **click** of the layers button; hover-open/mouseleave-close removed (stutter fix #2).
- Sections top-to-bottom: BASEMAP (radio rows) · USER CHECK-INS (n) (master toggle in
  header; segmented Hour/Today/Whole con + "match a handle…" search + type chips inside) ·
  DEF CON 34 ROUTES (master + per-route rows) · RABBIT ROUTES · MY DEF CON RUNS ·
  COMMUNITY ROUTES. Empty sections stay hidden (current behavior).

### My Maps dialog (same shell, re-hierarchied)

- Section order (user decision): **MY FILES first**, then **SHARED WITH YOU**.
- MY FILES header: count badge + ⋯ menu (New folder / Refresh / Export all) — the floating
  top-right icon pair goes away.
- File rows: name + meta line; one labeled **Edit** button + ⋯ menu with labeled items
  (Share / Assign day / Save as Route / Export GPX / Delete) — replaces the five-icon
  strip. Actions fade in on hover/focus on pointer devices, always visible on touch.
- Footer (user decision): **[👟 Add run]** primary button bottom-right; quiet helper text
  bottom-left. Hint bar below the footer.
- SHARED WITH YOU: folder rows with SHARED badge + › affordance.

### Strava strip addendum (small, same change wave)

Cards currently show the amber "Assign a day" chip only on imported-but-untagged runs and
nothing on never-imported ones, making identical-looking cards behave differently. Every
non-tagged card gets an explicit action chip: **"Pick a day"** (imported, untagged) /
**"+ Import"** (never imported).

## Implementation notes

- Touchpoints: `lib/components/map/layer-control/LayerControl.svelte` (popover → dialog,
  keep all layer-instance wiring), `PublicOverlays.svelte`, `MyConRuns.svelte`,
  `CommunityRoutes.svelte`, `LayerTree.svelte` (basemap radios), My Maps
  (`lib/components/cloud/CloudStorage.svelte`), `StravaStrip.svelte` (chip labels only).
- Reuse the existing shadcn-svelte Dialog primitives already in `lib/components/ui/`
  (My Maps uses them today) so focus-trap/Esc/overlay come free.
- QuickStart hub actions (`quickStartAction` routes/runners) currently set `open = true`
  on the popover — they open the new dialog instead.
- Delete `title={m.shortDescription}` from route rows; feed `data-hint` → hint bar.
- Keep `composedPath()` outside-click care from the old panel in mind; shadcn Dialog
  handles overlay clicks, so the hand-rolled svelte:window listener is deleted.

## Testing

- Svelte-check delta only on touched files (baseline ~26-30 upstream errors).
- Playwright prod probe after ship: layers button opens dialog; no `title` attrs in
  route list; My Maps section order; hint bar text updates on hover.

## Out of scope

Layer data wiring (PublicOverlaysLayer etc.) is untouched — this is presentation-layer
only. The check-in filter *semantics* (window/match/types) are unchanged.
