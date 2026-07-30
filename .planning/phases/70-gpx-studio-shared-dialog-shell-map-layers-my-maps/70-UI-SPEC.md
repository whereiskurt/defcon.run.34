# Phase 70 UI Design Contract — Shared Dialog Shell (Map Layers + My Maps)

**Source:** Distilled from the user-approved design contract
`.planning/sketches/006-shared-dialog-shell/DESIGN.md` and winning interactive mockup
`.planning/sketches/006-shared-dialog-shell/index.html` (Sketch 006, Variant B
"Carded sections" ★, user-selected 2026-07-29 with two amendments: MY FILES above
SHARED WITH YOU; Add run in a bottom footer). The mockup is the visual reference of
record — when this document and the mockup disagree, the mockup wins.

## 1. Shell (both dialogs)

- Centered modal on the map, built on the existing shadcn-svelte Dialog primitives
  (`lib/components/ui/`): overlay, focus trap, Esc + outside-click close.
- Card: app dark surface, 1px border, ~14px radius, heavy drop shadow; width 420px
  (max 94vw); header / scrollable body / (optional footer) / hint bar.
- Header: 17px icon glyph · bold title (~1.125rem) · optional muted subtitle under the
  title · ✕ button top-right (muted, hover → text + subtle bg).

## 2. Section component (the ONE collapse idiom)

- Carded treatment: each section is its own card inside the body — slightly raised
  surface (`surface-2`-equivalent), 1px border, ~8px radius; body has ~12px padding and
  ~10px gap between section cards.
- Section header row: left chevron button (▾ open, rotates -90° to ▸ closed, 150ms) ·
  uppercase 11px tracked (0.12em) bold muted label (label also toggles collapse) ·
  optional trailing: count badge (muted mono) → ⋯ menu button → master checkbox
  (rightmost). Open sections show a 1px divider under the header.
- Master checkbox semantics (must match today's PublicOverlays behavior): unchecking
  collapses the section, dims its label (~55% opacity), and cascades OFF to child rows;
  checking re-expands and cascades ON. The chevron still folds/unfolds freely afterward.

## 3. Row / chips / hint bar

- Layer row: checkbox or radio (accent green) · 10px round color dot · label
  (truncating). Hover: faint white 4% bg. Row height compact (~28px).
- File row (My Maps): 17px icon · name (semibold, truncating) + 11px muted meta line ·
  trailing actions: labeled `Edit` button + `⋯` menu. Actions fade in on hover/focus on
  pointer devices; always visible on touch viewports.
- ⋯ menu: dark popover, 4px padding, labeled items with small glyphs; danger item
  (Delete) in red below a separator.
- Chips: pill vocabulary only. Segmented single-select (Hour / Today / Whole con):
  joined pills, active = accent tint bg + accent text + semibold. Multi-select type
  chips (🐇 Rabbit #e6007a · ★ Admin #f4a240 · ⚡ Wildhare #00c2b8 · ☆ OG #8b5cf6):
  when ON, border/text take the type color and bg gets ~13% tint.
- Handle search: full-width quiet input, 12px text, border → accent on focus.
- Hint bar: fixed strip at the very bottom of the dialog (below footer if present):
  `ⓘ` glyph + 12px muted one-liner showing the hovered/focused row's description;
  default "Hover a row for details". Replaces ALL native `title=` tooltips — nothing
  floats over the list, ever.

## 4. Map Layers dialog

- Trigger: CLICK on the layers CustomControl button (no hover-open, no
  mouseleave-close).
- Section order: BASEMAP (radio rows: Dark ● default, Outdoors, Satellite,
  OpenStreetMap…) → USER CHECK-INS (n) (master checkbox in header; body = segmented
  window chips, handle search, type chips, optional "only 🐇 <runner> ✕" clear chip) →
  DEF CON 34 ROUTES (master; per-route rows with color dots) → RABBIT ROUTES →
  MY DEF CON RUNS → COMMUNITY ROUTES. Empty sections hidden.

## 5. My Maps dialog

- Header: ☁ My Maps + subtitle "Your DEF CON run folder".
- Section order: MY FILES (count badge + header ⋯ menu: New folder / Refresh /
  Export all) THEN SHARED WITH YOU (folder rows: 🌐 icon, name, SHARED pill badge, ›).
- Footer: muted helper text left ("GPX up to 10mb") · primary accent "👟 Add run"
  button right. Hint bar below the footer.

## 6. StravaStrip chips

- Imported-untagged: amber chip reads "Pick a day" (actionable look).
- Never-imported: quiet "+ Import" chip.
- Tagged: unchanged (✓ weekday, card dimmed/disabled).

## 7. Accessibility & states

- All collapse chevrons are real buttons with aria-labels; chips are buttons with
  visible selected state not conveyed by color alone (weight + tint).
- Dialog focus is trapped; Esc closes; focus returns to the trigger.
- Hint bar also responds to keyboard focus (focusin), not only mouse hover.
- Loading/empty: sections render only when their store has content (existing guards);
  My Maps empty state keeps current copy.

## 8. Verification hooks (for the prod probe)

- Layers button click → dialog with role=dialog visible.
- `document.querySelectorAll('[data-layer-row] [title]').length === 0` (no native
  tooltips on rows).
- My Maps: MY FILES section precedes SHARED WITH YOU in DOM order; footer contains the
  Add run button.
- Hovering a route row changes the hint bar text.
