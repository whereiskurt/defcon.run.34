# PayPhone "The Booth" Marker Art Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ☎️ emoji marker with an SVG payphone booth (taped "CALL ME! 725-404-3234" note) and a monospace "☎ 725-404-3234" pill — spec "Enhancement v2" in `2026-07-27-payphone-goldstein-seed-design.md`.

**Architecture:** Single-file change to `payphone.ts` (DOM marker innerHTML + injected CSS). Booth art is the A2 mockup SVG from `.superpowers/brainstorm/32273-1785190858/content/booth-label.html`, inlined. No feed/eggs/infra changes.

**Tech Stack:** mapbox-gl DOM Marker, inline SVG, CSS keyframes.

## Global Constraints

- SVG ~48×78 px, viewBox `0 0 60 98`; enclosure `#1e3a5f`/`#4a6f9e`, faceplate `#c9ced6`, note text "CALL ME!" red `#c1121f` + "725-404-3234" bold monospace
- Pill text exactly `☎ 725-404-3234`, monospace, amber border style retained
- Keep: bob keyframe, amber conic rays (px insets sized to SVG box), `anchor:'bottom'`, click → `dc34-payphone`, `prefers-reduced-motion` guard
- Ship run.gpx only via buildpub.yml + deploy.yml (GitHub Actions)

### Task 1: Swap the marker art in payphone.ts

**Files:** Modify `apps/run.gpx/gpx-studio/website/src/lib/components/map/payphone.ts`

- [ ] Replace `.dc34-payphone-phone` CSS (emoji sizing) with a fixed-box rule (`width:48px;height:78px`) keeping bob/drop-shadow; rays `::before` inset `-12px`, same conic gradient/mask/animations; label rule gains `font-family:'Courier New',monospace`
- [ ] Replace `el.innerHTML` emoji div with the booth SVG (exact A2 mockup markup) inside `<div class="dc34-payphone-phone">…</div>`; label div → `☎ 725-404-3234`
- [ ] Update the file header comment (emoji → SVG booth)
- [ ] Commit: `feat(gpx-studio): payphone marker becomes The Booth (SVG + number pill)`

### Task 2: Verify

- [ ] `cd apps/run.gpx && ./build-frontend.sh` clean
- [ ] `npx svelte-check` — no errors mentioning payphone
- [ ] Commit fixups if any

### Task 3: Ship

- [ ] Push branch → PR → merge (pre-authorized) → verify merged → delete branch
- [ ] `buildpub.yml -f apps=run.gpx -f regions=use1` → watch
- [ ] `deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true` → watch
- [ ] Live verify: deployed studio chunk contains `725-404-3234` + `dc34-payphone-phone` SVG markup (`curl` the built JS asset or Playwright map probe)
