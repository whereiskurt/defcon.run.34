---
sketch: 004
name: landing-hero-tiles
question: "What DC33-style photo-tile layout should the run.defcon.run/use1/ landing use?"
winner: null
tags: [landing, tiles, dashboard, run.human]
---

# Sketch 004: Landing Hero Tiles

## Design Question
Kurt wants the DC34 landing to go back to the DC33 dashboard approach: a 12-col grid of
photo tiles (spans ~4/8/12, 300px tall, image-filled HeroUI cards with blurred footers).
Which composition works for DC34 — and where do the existing Who Am I / Routes CTAs live?

## Source Material (last year's arts)
Photos lifted from `~/working/defcon.run.33/apps/nx/apps/webapp/public/dashboard/` into
`assets/`: `NewMeetPoint.jpg` (LVCC West rally point), `DoubleDownSaloon.jpg` (Shut Up
and Drink interior), `Rebar.jpg`, `VegasRunMap.png`, `defcongroup.jpg` (DC33 crew),
plus root `analogmap.jpg`. **No Las Vegas sign photo exists locally** — sketched as a
neon SVG sign pastiche; needs a real photo (or we keep the neon sign, it's fun).
DC33 layout reference: `apps/nx/apps/webapp/src/app/(headfoot)/dashboard/page.tsx`
(max-w-900, grid-cols-12, h-[300px], col-span-4/8/12, CMS-driven card fields).

## How to View
open .planning/sketches/004-landing-hero-tiles/index.html

## Variants
- **A: DC33 Classic 900** — faithful port: welcome + existing CTA buttons on top, then a
  900px 12-col grid (8+4 / 4+4+4). Least surprise, least work.
- **B: Full-Bleed Hero + Strip** — big 420px hero (DC33 group photo) with the welcome +
  CTAs *inside* it, then a 3-up strip and a full-width neon-sign banner.
- **C: Bento Mix 1100** — wider asymmetric bento: tall 2-row map tile, mixed spans
  (7/4/3), short full-width community strip. Most modern, most layout work.

## What to Look For
- Where should Who Am I / Routes live — buttons above the grid (A/C) or inside a hero (B)?
- Tile height rhythm: uniform 300px (A) vs mixed heights (C)?
- Does the neon SVG sign hold up next to real photos, or does it demand a real photo?
- Phone viewport (toolbar 📱): all tiles stack to full width — does the order still tell
  the story (meetup → routes → socials)?
