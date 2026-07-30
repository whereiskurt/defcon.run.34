---
sketch: 006
name: shared-dialog-shell
question: "What section/row treatment should the shared dialog shell use for Map Layers + My Maps?"
winner: "B"
tags: [gpx-studio, dialog, layers, my-maps]
---

# Sketch 006: Shared Dialog Shell

## Design Question
Both gpx-studio surfaces (Map Layers — currently the hover popover — and My Maps) are being
rebuilt as centered dialogs sharing one shell: same header, ONE chevron/collapse idiom,
same row + chip primitives, and a bottom hint bar that replaces the native `title=`
tooltips (the hover stutter). This sketch asks: what visual treatment do the *sections*
inside that shell get?

## How to View
open .planning/sketches/006-shared-dialog-shell/index.html

## Variants
- **A: Flat sections** — one surface, hairline separators between sections. Closest to today's My Maps; path of least resistance.
- **B: Carded sections** — each section is its own raised card inside the dialog body. Strong grouping, more chrome.
- **C: Inset groups** — section label sits *outside* an inset "well" containing the rows (macOS grouped-list style). Quietest headers, strongest row containment.

## What to Look For
- Do the section headers finally read as *sections* (vs. today's "Basemaps" masquerading as a panel title)?
- Master checkbox in the section header: toggle it — group collapses + dims. Does that feel right in each treatment?
- Hover route rows: descriptions appear in the bottom hint bar (no floating tooltip, no stutter). Enough affordance?
- My Maps: labeled **Edit** + ⋯ menu instead of the five-icon strip; **Add run** as the MY FILES primary button; folders vs files hierarchy.
- Check-ins block: segmented time window + handle search + colored type chips — does it look tidy at 420px?
