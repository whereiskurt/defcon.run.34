---
sketch: 003
name: hud-glow-leader-rank
question: "HUD ring + pin rail synthesis: how thick/blurry is the glow, and how do relative RANK + a LEADER state read?"
winner: "D"
tags: [qr, flair, glow, rank]
---

# Sketch 003: HUD Glow + Leader Rank

## Design Question
Synthesis of the winners (001-B HUD Ring + 002-A Pin Rail) with the glow pushed
much harder, and the tier model changed from absolute connect-counts to
**relative social rank** — a percentile of the whole field that can decay when
other runners out-scan you. Top of the board earns a distinct gold LEADER state.

## How to View
open .planning/sketches/003-hud-glow-leader-rank/index.html

Drag the SOCIAL RANK slider: UNRANKED → TOP 50% → TOP 25% → TOP 10% → TOP 5% → ♛ LEADER.
Note the trend line under the readout — TOP 10% deliberately shows the decay story
("▼ was TOP 5% yesterday — the meetup you missed cost you").

## Variants
- **A: Soft Aura** — wide blurred radial halo behind the card grows/brightens with rank; breathes at LEADER.
- **B: Neon Tube** — the ring itself is the glow: two blurred thick strokes under a crisp core, bent-neon look.
- **C: Reactor** — rotating conic energy ring layered on the neon tube; spins faster at higher rank.
- **D: Reactor ★ Tuned (WINNER)** — C plus: 9px blurred glowing scanline; earned badges gain
  drop-shadow glow that escalates with rank (rail border ignites at TOP 5%, badges breathe gold
  at LEADER). Implementation note: badge hexes are clip-path'd, so the glow must live on a
  wrapper element (drop-shadow on the parent) — box-shadow on the clipped element is invisible.
  Scan-safety note: the sweeping scanline crosses the QR card (~3% of card height, well inside
  EC-H's ~30% budget after the ~6% center knockout), keep it translucent and never widen past
  ~15px at 300px card size.

All variants: gold color shift + ♛ SOCIAL LEADER chip at rank 1, green scanline at TOP 10%+,
pin rail below (002-A winner), genuine production QR untouched in the middle.

## Early Gratification (tuning pass on D)
Flair starts at TOP 50%, not TOP 10%: faint reactor + soft scanline + badge glow
from the first band, and a "NEXT // <band>: <what unlocks>" teaser line under the
readout at every rank so runners always see there's more to come.

## Hidden Hotspot Easter Egg (variant D)
Invisible 84px circular hotspot centered on the **DC jack logo** in the QR's
center knockout ("jack in"). Two trigger mechanics implemented to compare:
**HOLD** (1.5s; a green glow ring starts charging at 200ms and swells as it
fills — casual taps see nothing) and **TRIPLE-TAP** (3 taps inside 900ms). On claim:
radial burst + toast "⚑ COVERT CHANNEL FOUND // +10 SOCIAL · +25 CTF" + a gold
⚑ EGG badge joins the rail. One claim ever; repeats show "ALREADY DRAINED".
The sketch has a "reveal egg hotspot" debug checkbox — production ships with no
visual cue. Spec intent: +10 to the social/connect score (counts toward rank)
and +25 ctfScore, once per user.

## Scanline (2x pass)
18px, blur(4px) at full strength (10/14px at TOP 50/25%) — ~6% of card height.
Combined with the ~6% center knockout this stays well inside EC-H's ~30% budget,
but production must keep the overlay translucent and never widen it further.

## What to Look For
- Is the glow finally thick/blurry enough? Which construction reads best at phone size?
- Does gold-at-LEADER feel earned, or should LEADER stay magenta and just burn brighter?
- Does the decay trend line ("▼ was TOP 5% yesterday") motivate or discourage?
- Reactor's motion: delightful or distracting on a whoami page you open daily?
