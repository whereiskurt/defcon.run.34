---
status: passed
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
source: [70-VERIFICATION.md]
started: 2026-07-30T18:05:00Z
updated: 2026-07-30T18:40:00Z
---

## Current Test

number: -
name: all tests complete
awaiting: none

## Tests

### 1. Six-section order with real signed-in data
expected: Signed in with con-day-assigned runs and at least one published community route, Map Layers shows MY DEF CON RUNS after the DEF CON 34 / RABBIT route groups, and COMMUNITY ROUTES last.
why_human: The prod probe stubs `**/use1/api/gpx/**` to `{}`, so both manifests came back empty and neither section ever rendered. Probe assertion 5 passed while explicitly skipping them — only 4 of the 6 ordered sections were exercised live. Source order (LayerControl.svelte:495-503) is correct; the live rendering is unconfirmed.
result: passed

### 2. Strava card chip states
expected: With (a) a tagged import, (b) an imported-but-untagged activity, (c) a never-imported activity — tagged reads dimmed/disabled with "✓ <weekday>"; imported-untagged shows the amber "Pick a day" chip opening the popover in assign mode; never-imported shows the quiet "+ Import" chip opening it in import mode.
why_human: "Reads as actionable or done" is a visual judgment. The prod probe has ZERO Strava assertions — it stubs `hasStrava: false` — which contradicts 70-02-SUMMARY's claim that visual confirmation was deferred to the probe. Source is verified; the visual read is not.
result: passed

### 3. Modal dimming while toggling layers
expected: Kurt confirms the modal treatment is acceptable in practice on desktop and phone.
why_human: The dialog is a focus-trapping modal with a full-viewport `bg-black/50` overlay, so unlike the old anchored popover the map is dimmed and non-interactive while toggling. Centered modals were the explicit sketch-checkpoint choice, but the dimming consequence was not part of that decision.
result: passed

### 4. Hint bar on un-hinted rows
expected: Kurt decides whether the hint bar showing the default "Hover a row for details" while literally hovering a basemap radio / per-day sub-header / My Maps folder header is acceptable.
why_human: `BasemapSection.svelte:43-51` passes no `hint` to its Rows, and `Section` puts `data-hint` only on the header (a sibling of the children wrapper, not an ancestor), so `closest('[data-hint]')` resolves to null. Cosmetic and subjective.
result: passed

### 5. My Maps gate screens
expected: Signed out, and with an account lacking the gpxstudio service, the gate screen shows only its own message and (when signed out) the Sign In button — no "Add run" footer.
why_human: Written to capture the CR-02 dead-end BEFORE it was fixed. PR #1112 gated the footer and probe assertion 13 covers it, so this is now live confirmation of the fix rather than a complaint.
result: passed

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None. Kurt reviewed all five items against live prod (v0.0.107) and reported
"everything is looking good" — a blanket pass covering the two data-dependent
render checks (1, 2) and accepting the two subjective calls as shipped:

- Test 3 — the modal `bg-black/50` dimming of the map while toggling layers is
  accepted as-is. No change to the centered-modal treatment.
- Test 4 — the hint bar reading its default copy while hovering an un-hinted row
  (basemap radios, per-day sub-headers, My Maps folder headers) is accepted as-is.
  `BasemapSection` still passes no `hint` to its Rows; that stands as designed.

Test 5 confirmed the CR-02 footer fix (PR #1112) from the user side.

