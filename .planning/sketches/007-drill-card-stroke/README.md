---
sketch: 007
name: drill-card-stroke
question: "How much stroke do drill token cards need to read as cards in BOTH themes, and what does a selected row look like?"
winner: TBD
tags: [leaderboard, drill, borders, light-dark, run.human]
---

# Sketch 007: Drill Card Stroke + Row Selected

## Design Question
The drill token cards shipped in Phase 52 (`bg-default-100 border border-default-200`)
were tuned in dark mode. In **light mode they nearly vanish** — near-white cards on a
near-white surface separated by a 1px #e0e0e0 hairline, which at a glance reads as one
undifferentiated block (see Kurt's 2026-08-01 screenshot). The expanded own-row's 1px
green border has the opposite problem: too thin to frame a tall block, so it reads as a
stray line rather than a selection.

Two questions, one sketch:
1. **How much stroke** does a token card need to read as a discrete card in both themes?
2. **What is "row selected"** — how does the expanded/own row announce itself?

## How to View
open .planning/sketches/007-drill-card-stroke/index.html

Toggle ☀/☾ top-right — **every variant renders in both themes**, because the whole point
is that today's treatment only works in one of them. Click any collapsed row to see its
selected state.

## Variants
- **A: Weighted hairline** — same anatomy, harder-working values: 1px border at real
  contrast + a surface step so the card sits *on* the panel. Selected = 2px accent frame
  + tinted heading. The conservative fix; smallest diff.
- **B: Card edge** — 1.5px border with a darker bottom edge, so cards read as physical
  chips with a light source. Selected = 2px accent frame + soft accent glow.
- **C: Tone rail** — a 4px left rail colour-keyed to section (green runs / violet social /
  amber CTF) plus a real border, so a card's *type* is scannable before you read it.
  Selected = full accent frame + matching rail.
- **D: HUD bracket** — inset well, corner brackets on the selected row. Continues the
  clearance-frame language from sketches 001/003 rather than inventing a new one.

## What to Look For
- **Light mode first** — that is the broken case. Do the cards separate from the panel?
- Does the selected row read as *selected*, or just *outlined*?
- At 3 sections stacked (Runs / Social / CTF), does the treatment get noisy? C and D add
  the most ink — check them at density, not in isolation.
- Does the covert badge still pop against the heavier border?
- Dark mode regression check: today's look is fine there. Does the fix make it worse?
