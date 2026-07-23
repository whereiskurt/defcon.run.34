---
sketch: 001
name: clearance-frame-evolution
question: "How does the runner QR frame level up L0→L5 as unique scans accrue?"
winner: "B"
tags: [qr, flair, tiers]
---

# Sketch 001: Clearance Frame Evolution

## Design Question
As a runner accumulates unique scans, how should the on-screen QR visually
escalate — signaling "you're scanning a popular person" — without ever touching
the scan zone (quiet zone + finder patterns sacred)?

## How to View
open .planning/sketches/001-clearance-frame-evolution/index.html

Drag the CLEARANCE slider (L0→L5) to watch each variant escalate.
The QR is the genuine production render (v5, 37×37, `https://q.defcon.run/r/<token16>`).

## Variants
- **A: Corner Brackets** — targeting brackets appear, colorize magenta, double up, glow, and pulse at max clearance.
- **B: HUD Ring** — a progress track around the card fills toward the next level; tick marks light per level; terminal-green scanline sweeps at L3+.
- **C: Dossier Stamps** — the QR becomes a "RUNNER FILE": classification bar, side annotations, rotated clearance stamp, CONNECT INDEX tally, and a red MOST WANTED RABBIT stamp at L5.

## What to Look For
- Which escalation reads instantly at arm's length ("that person is popular")?
- Does the L0 (fresh account) state still look good, or embarrassingly bare?
- Is max tier (L5) exciting or noisy? Would you be proud to flash it?
- All flair sits outside the white QR card — scan integrity preserved by construction.
- Placeholder thresholds: 5 / 15 / 30 / 60 / 100 unique connects (spec decision).
