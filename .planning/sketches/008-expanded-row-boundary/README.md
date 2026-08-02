---
sketch: 008
name: expanded-row-boundary
question: "How do two EXPANDED runner rows read as separate blocks when the board sits on the map?"
winner: "A: Framed expanded row"
tags: [leaderboard, rows, accordion, borders, run.human]
---

# Sketch 008: Expanded Row Boundary

## Design Question
Sketch 007 fixed the drill CARDS but not the ROWS. With two runners expanded, one runner's
drill flowed straight into the next runner's header with a single 1px rule between them —
and because the board sits on the live map background, that rule vanished. A separator was
never going to be enough: the rows needed to be BOUNDED, not underlined.

## How to View
open .planning/sketches/008-expanded-row-boundary/index.html

Four panels, and the FIRST one is what was live at the time, so the problem sits next to
the fixes. Backdrop is faked map lines — comparing on a flat background would have been
dishonest, since the map bleeding through is half the problem.

## Variants
- **A: Framed expanded row** ✅ **WINNER** — every row becomes its own bounded card:
  1.5px frame, rounded, a faint fill, header band on top. Own row keeps green.
- **B: Gap + header band** — no frame; 16px of real air between runners plus a band and a
  solid fill. Most breathing room, fewest runners per screen.
- **C: Heavy rule + band** — keeps the flat single-panel board; 3px divider plus a tinted
  header. Smallest diff, but still a line doing the work.

## Why A
The faint FILL is the load-bearing part, not the border: it stops the map from reading as
the shared background of two adjacent rows. C is the same idea as the thing that failed,
only louder.

## Implementation
`.board-row` / `.board-row-own` / `.board-row-head` in `run.human/src/styles/globals.css`;
the Accordion moved from `variant="bordered"` to `variant="light"` with
`flex flex-col gap-2.5`, so the group no longer draws one shared frame around every row.

The under-header rule is keyed off `:has([aria-expanded="true"])` so it appears only while
a row is open — collapsed, it would double up with the card border a pixel below. If
`:has()` is unavailable the rule is simply absent and the band plus frame still separate
everything.
