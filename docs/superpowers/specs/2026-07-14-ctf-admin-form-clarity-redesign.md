# CTF Admin Form — Clarity Redesign

> **SUPERSEDED by `2026-07-14-ctf-flag-types-and-form-redesign-design.md`.**
> This clarity redesign ("A") is folded into that combined spec as Slice 1's form work.
> Kept for history; build from the combined spec.

**Date:** 2026-07-14
**Status:** Superseded (folded into the combined flag-types spec)
**Scope:** Frontend-only redesign of the "New/Edit CTF challenge" admin form.
**Author:** Kurt + Claude
**Related:** `project_ctf_judge_v21` (v2.1 CTF judge), the `dc34-egg` easter egg seed.

---

## Problem

The current CTF challenge form (`apps/run.human/webapp/src/components/admin/CtfForm.tsx`)
exposes the raw scoring/rate-limit knobs with no explanation. Admins can't tell:

- what **Ceiling** does (it replaces Point max inside an active time window);
- what the **Max attempts / Rate-limit window** pair does (anti-spam on *wrong guesses*,
  seconds-scale — not a solve-frequency limit);
- that a flag awards **once per player** (re-submits never double-count);
- that the standalone **Points** field is **legacy and ignored** by v2.1 scoring
  (this caused a real "is it 10 or 1000?" confusion when seeding `dc34-egg`).

The result is an abstract, error-prone screen. This redesign makes the common cases
one-click and pushes the raw knobs into an Advanced drawer, while explaining the
abstract mechanics in plain language.

**Explicitly out of scope (separate spec, "B"):** dynamic answers — wordlists /
one-time-use codes, TOTP/OTP flags, seed→OTP chaining, per-24h submit limits. This
redesign only reshapes the UI over the *existing* static-answer scoring model. The
Advanced drawer layout should leave room for future flag-type controls but builds none.

---

## Goals / Non-Goals

**Goals**
- Common challenge shapes are pickable as a **type preset** that fills scoring for you.
- Every abstract field has plain-language help.
- A **live scoring preview** shows the point curve as you type.
- The one-award-per-flag rule is stated inline.
- Remove the dead **Points** field.
- Answers stay masked / write-only.

**Non-Goals**
- No server, judge, data-model, or API changes. The form reads/writes the exact same
  `ctf_upsert` payload it does today.
- No new npm dependencies.
- No change to how existing rows are stored or scored.

---

## Design

### Layout (top → bottom)

1. **Challenge type** — a segmented control:
   `Flat points · First-blood race · Timed drop · Easter egg · Custom`.
   Selecting a type fills the Advanced fields with that preset's values (see table).
   `Custom` fills nothing and opens the Advanced drawer.
   Help line: *"Sets the scoring for you — tweak in Advanced anytime."*

2. **Basics** (always visible):
   - **Name** — unchanged (immutable after create; lowercase-normalized server-side).
   - **Answer** — unchanged: masked, hashed server-side, blank-on-edit keeps existing hash.
   - **Type-appropriate scoring surface** (see §Simple surfaces).
   - **Enabled** toggle.

3. **Live preview** — a computed line, e.g.
   `📈 1st solver 1000 · 50th 510 · 100th 1 pts`, recomputed on every field change
   from a client-side mirror of `computePoints` (§Preview formula).

4. **One-award note** — always visible:
   *"ℹ️ One award per player — re-submitting the same flag never double-counts."*

5. **▸ Advanced** (collapsed by default; auto-expanded for `Custom`, or on edit when the
   loaded row doesn't match a known preset): the full existing grid —
   Point max / Point floor / Max solves / First-blood bonus, Time tiers, Anti-spam,
   Effect (JSON). Every knob remains directly editable here; presets only pre-fill it.

6. **Actions** — Create/Save · Cancel · Delete (edit only), unchanged.

### Simple surfaces per type

The Basics section shows a *friendly* control per type that writes through to the
Advanced fields (the Advanced fields remain the source of truth on save):

| Type | Simple surface | Writes to Advanced |
|---|---|---|
| **Flat points** | one **Award (points)** field | `pointMax = pointFloor = Award`, `maxSolves = 100000`, `firstBloodBonus = 0`, no tiers |
| **First-blood race** | **Top / Floor / Winners** (3 fields) | `pointMax=Top, pointFloor=Floor, maxSolves=Winners, firstBloodBonus=250` |
| **Timed drop** | **Award** (in-window value) + a **window** (from/to) | one time tier `{from,to,ceiling=Award}` raised over a lower base: `pointMax=100, pointFloor=1` |
| **Easter egg** | one **Award** field (default 10) | flat mapping as above + `effect={kind:"confetti",intensity:11}` |
| **Custom** | — (Advanced opens) | nothing pre-filled |

**Preset default values** (all editable afterward):

- Flat points: Award = 100.
- First-blood race: Top 1000, Floor 100, Winners 100, first-blood bonus 250.
- Timed drop: Award 500 (the in-window ceiling) over base `pointMax=100, pointFloor=1`,
  window = DEF CON 34 (`2026-08-06` → `2026-08-10`, existing preset). So solves are worth
  up to 500 during the window and up to 100 outside it — this is what makes Ceiling visible.
- Easter egg: Award 10, confetti effect.
- Anti-spam default for all presets: Max attempts 5, Rate-limit window 60s.

Editing an Advanced field that a preset owns is always allowed; the type chip simply
reflects the last preset applied and does not lock anything.

### Plain-language copy

- **Ceiling** (time-tier field): *"The most a solve can be worth while this window is
  active — it replaces Point max for this window. Blank = use Point max."*
- **Anti-spam** (relabels Max attempts + Rate-limit window into one row):
  *"Allow **[N]** wrong guesses per **[X]** seconds, then briefly block. Stops
  brute-forcing; does not limit real solves."*
- **Time tiers** header stays but gains: *"Optional. Raise or lower the point ceiling
  during a date range (e.g. a scheduled reveal)."*
- **Point max / floor / Max solves**: short help — *"First solver earns Point max; the
  Nth solver's award declines linearly to Point floor at Max solves; past Max solves =
  0 points (still celebrates)."*

### Preview formula

Mirror `apps/run.human/webapp/src/lib/ctf-scoring.ts` `computePoints` in a tiny
client helper (e.g. `ctf-scoring-preview.ts`, ~10 lines) so the form can show the curve
without a round-trip. It must match the server formula exactly:

```
ceiling = active tier ceiling (for "now") ?? pointMax
span    = ceiling - pointFloor
frac(n) = maxSolves === 1 ? 1 : 1 - (n-1)/(maxSolves-1)
points(n) = round(pointFloor + span*frac(n)) + (n===1 ? firstBloodBonus : 0)   // 0 if n > maxSolves
```

Preview samples: n = 1, mid (⌈maxSolves/2⌉), and maxSolves. Guard against missing/NaN
fields (show "—" until enough fields are set).

### Removed

- The standalone **Points** input is deleted from the form. The redesign stops sending
  `points` in the `ctf_upsert` payload (the server attribute builder already treats it as
  optional; scoring ignores it). Existing rows' stored `points` values are left untouched.

---

## Data flow (unchanged)

Form → `postQrAction({ action: "ctf_upsert", ctf })` → `POST /api/admin/qr` →
`upsertCtf` → `ctfAttributes` (hashes answer server-side) → `Ctf` entity. Presets and the
preview are pure client-side; they change only which values the same payload carries.

## Edit-mode behavior

On edit, infer the type chip from the loaded row (match against preset signatures); if
none match, select **Custom** and expand Advanced. Answer field stays blank with the
"leave blank to keep" hint. Name stays disabled.

## Error handling

Unchanged: invalid Effect JSON blocks save with the existing inline error; numeric fields
coerce via the existing `numOrUndef`. The preview never throws — bad/partial input renders
as "—".

## Testing

- Unit-test the preset→Advanced mapping (each type produces the documented field values).
- Unit-test the preview formula against `computePoints` for representative
  `(n, pointMax, pointFloor, maxSolves, firstBloodBonus, tier)` cases, including
  `n > maxSolves` (→ 0) and `maxSolves === 1`.
- Unit-test edit-mode type inference (a known preset row selects its chip; an off-preset
  row selects Custom).
- Manual: create one challenge of each type; confirm the saved row matches the table and
  the preview matches the eventual award.

## Rollout

Ship on a branch off `origin/main` (`gsd/ctf-admin-form-clarity`); the main working tree is
on an unrelated phase branch and lacks the CTF code. Standard PR → review → release of
run.human. No infra or data migration.

---

## Follow-on (not this spec): "B" — dynamic flag types

Captured for the next design cycle so the Advanced drawer anticipates it:
wordlist / one-time-use codes, **TOTP flags** (reuse the real RFC 6238 implementation in
`apps/run.mqtt/meshtk/pkg/otp/totp.go` — Go, ~40 lines to port to the TS judge; DC33 seed
`otpauth://` URLs already exist in `meshtk.bak.yaml`), a rotating "current/next" QR display,
seed→OTP flag chaining, and per-24h submit limits. Each needs judge + data-model work and
gets its own spec.
