# Phase 55 — UI Design Contract (Scoring-Window Picker)

**Status:** APPROVED (authored inline; extends the Phase-54 UI-SPEC — same locked design system, no new system)
**Scope:** ONE new sub-surface — the day/time/tz window picker inside the existing **Scoring window & limits** section of `CtfForm.tsx` (replaces the Phase-54 Slice-2 placeholder note). No player-facing UI (the window is enforced silently in the judge — a closed window is indistinguishable from a wrong answer, so there is deliberately NO player-visible "come back later" surface).

## Design system
Reuse Phase-54 tokens verbatim from `qr-ui.ts` / the `cls.*` helpers and HeroUI. No new component library, no new dependency. Inherit the Phase-54 UI-SPEC's spacing (4px base + documented half-step exceptions), typography roles, and HeroUI semantic color tokens (`bg-background` / `content1` / `primary` accent / `danger`).

## Component inventory (all HeroUI, matching sibling controls in the section)
- **Enable toggle** — a `Switch`/`Checkbox` "Restrict scoring to a time window" that reveals/hides the picker. Off ⇒ `scoreWindow` is undefined (always-open); this is the default for every existing flag.
- **Weekday multi-select** — 7 toggle chips (Sun–Sat) or a HeroUI `CheckboxGroup`; multiple selectable. Matches the segmented-preset control styling from Phase 54.
- **Start time / End time** — two `TimeInput` (or `Input type="time"`) controls, 24h HH:mm, labeled "Opens" / "Closes".
- **Timezone selector** — a `Select` with exactly three options **PT / ET / UTC**; the stored value is the IANA id (`America/Los_Angeles` / `America/New_York` / `UTC`). Label shows the friendly abbreviation; value persisted is the IANA id.
- **"DEF CON run hours" quick-set chip** — a `Chip`/`Button` (accent `primary`, one of the section's reserved accent uses) that one-click fills: days = Thu·Fri·Sat·Sun, Opens 06:00, Closes 08:00, tz = `America/Los_Angeles`. After applying, all fields remain individually editable (same "presets pre-fill, stay editable" rule as Phase-54 challenge-type presets).

## Copywriting (plain-language, matches Phase-54 help-copy voice)
- Section helper: **"Only credit solves during this window. Outside it, a correct answer silently doesn't score — players can't tell the window is closed."** (states the covert-safe behavior explicitly for the admin).
- Quick-set chip: **"DEF CON run hours"** with sub-hint **"Thu–Sun, 6–8 AM PT"**.
- Timezone note: **"Times use this timezone; daylight saving is handled automatically."**
- Empty/disabled state: when the toggle is off, show **"Scorable any time."**

## Interaction / states
- Toggling the enable switch off clears the picker's contribution to the saved payload (no `scoreWindow` persisted).
- Round-trips through save→edit: on edit, the picker rehydrates from the stored `scoreWindow` (days, times, IANA tz → mapped back to the PT/ET/UTC label).
- Live scoring preview: if the form's live preview is showing and a window is set, surface a small "window-gated" annotation (non-blocking) — the preview still shows the point value; the window affects *whether* it scores, not *how much*.
- Accessibility: every control labeled; the quick-set chip has an accessible name; ≥40px touch targets consistent with the Phase-54 admin surface.

## Out of scope (deferred)
- No player-facing countdown or "opens in Nhh" UI (would leak the covert-safe silence).
- Wordlist (Slice 3 / Phase 56).

## 6-dimension self-check
1. **Copywriting** — specific, covert-safe admin helper + friendly quick-set copy. PASS.
2. **Visuals** — reuses the section's existing hierarchy; quick-set chip is the focal action. PASS.
3. **Color** — HeroUI semantic tokens; accent `primary` reserved for the quick-set chip (an enumerated Phase-54 accent use). PASS.
4. **Typography** — inherits Phase-54 roles; no new sizes. PASS.
5. **Spacing** — inherits the 4px base + section's documented half-steps. PASS.
6. **Registry safety** — no shadcn/registry, no new dep; HeroUI reuse only. PASS.
