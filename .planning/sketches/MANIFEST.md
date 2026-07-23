# Sketch Manifest

## Design Direction
Hacker-terminal "clearance level" flair around the DC34 runner social QR. As a runner
accumulates unique scans, their on-screen QR (whoami, header dropdown, wallpaper/share
cards) levels up — frames, glows, and monospace clearance readouts escalate, signaling
"you're scanning a popular person." Discrete earned badges (bib-purchaser starter badge,
milestone pins) dock around the QR. Digital-only: the printed bib keeps the clean stealth
QR untouched. Hard constraint: quiet zone + finder patterns are sacred — all flair lives
outside the white QR card (white-pupil experiments previously broke jsQR).

## Reference Points
- run.human styled runner QR (`renderStyledQr.ts`): ink #111118, magenta #c4157a,
  rounded finder eyes w/ stealth-34 pupils, dcjack center knockout, EC-H.
- gpx ghost dossier popups / matrix eggs (redacted-doc, terminal energy).
- New payload `https://q.defcon.run/r/<token16>` = QR v5 (37×37) vs today's v9 (53×53).

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | clearance-frame-evolution | How does the QR frame level up L0→L5 as unique scans accrue? | B: HUD Ring | qr, flair, tiers |
| 002 | badge-slots | Where do discrete earned badges (bib-buyer, milestones) live around the QR? | A: Pin Rail | qr, badges |
| 003 | hud-glow-leader-rank | HUD ring + pin rail synthesis: how thick/blurry does the glow get, and how does relative RANK (percentile, decays as others overtake) + a LEADER №1 state read? | D: Reactor Tuned | qr, flair, glow, rank |

## Model shift (from 003 intake)
Tiers are RELATIVE, not absolute: flair is driven by your rank/percentile among all
runners' unique-connect counts. Miss a social event while everyone else scans → your
percentile (and your QR's flair) drops. Top of the board gets a distinct LEADER
treatment (gold shift).
