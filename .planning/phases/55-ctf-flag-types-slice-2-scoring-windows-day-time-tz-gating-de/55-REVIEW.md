---
phase: 55-ctf-flag-types-slice-2-scoring-windows-day-time-tz-gating
reviewed: 2026-07-15T00:00:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - apps/run.human/webapp/src/lib/ctf-score-window.ts
  - apps/run.human/webapp/src/lib/ctf-judge.ts
  - apps/run.human/webapp/src/components/admin/ctf-form-model.ts
  - apps/run.human/webapp/src/components/admin/CtfForm.tsx
  - apps/run.human/webapp/src/lib/qr-admin.ts
  - apps/run.human/webapp/src/entities/qr.ts
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 55: Code Review Report

**Reviewed:** 2026-07-15T00:00:00Z
**Depth:** deep
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the Slice-2 scoring-window feature: the pure `isWithinScoreWindow` predicate + shared constants (`ctf-score-window.ts`), the judge step-3 window gate (`ctf-judge.ts`), the form-state bridge (`ctf-form-model.ts`), the picker (`CtfForm.tsx`), the admin write passthrough (`qr-admin.ts`), and the `Ctf.scoreWindow` entity attribute (`qr.ts`).

**The judge invariant is correctly implemented.** The window gate fires BEFORE the state-mutating attempt-cap bump (ctf-judge.ts:295 precedes the `overAttemptLimit` upsert at :302), returns the shared `NON_SOLVE`, never passes the guess to the logger, and leaves the covert path (`solved`+`points` only, no `effect`) byte-untouched. `isWithinScoreWindow` is genuinely fail-closed (any Intl error → `false`), DST is handled by a single `Intl.DateTimeFormat`, the `"24"→"00"` midnight normalization is present, and the half-open `[from, to)` boundary is correct at minute granularity.

**One BLOCKER:** the enable-toggle OFF path does NOT clear a previously-stored window on edit — it silently preserves it, directly contradicting this phase's own UI-SPEC (lines 10/20/23) and the visible "Scorable any time." copy. Two WARNINGs cover the unguarded overnight/degenerate-window case (silent permanent never-score) and a lossy timezone round-trip on edit.

## Critical Issues

### CR-01: Toggling the window OFF does not clear a stored `scoreWindow` on edit — flag stays gated while UI claims "Scorable any time."

**File:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx:316-322,344,728-730` (with `ctf-form-model.ts:257-267` and `qr-admin.ts:380`)

**Issue:** When the admin unchecks "Restrict scoring to a time window" and saves an *existing* flag that has a stored window, the window is NOT removed — the flag remains silently gated. This contradicts the phase's own contracts:

- `55-UI-SPEC.md:10` — "Off ⇒ `scoreWindow` is undefined (always-open)"
- `55-UI-SPEC.md:20` — off state shows "Scorable any time."
- `55-UI-SPEC.md:23` — "Toggling the enable switch off clears the picker's contribution to the saved payload"
- `ctf-form-model.ts:257-262` docstring — "Off ⇒ nothing persisted (matching the UI-SPEC's 'toggling off clears the payload'), which the judge reads as always-open."

Trace of the actual behavior:
1. `formStateToScoreWindow(...)` returns `undefined` when disabled (`ctf-form-model.ts:264`).
2. `CtfForm.onSave` spreads it conditionally: `...(scoreWindow ? { scoreWindow } : {})` (`CtfForm.tsx:344`) → the key is OMITTED from the payload.
3. `ctfAttributes` omits the key too: `...(input.scoreWindow !== undefined ? { scoreWindow } : {})` (`qr-admin.ts:380`).
4. `upsertCtf` edits via `Ctf.patch({ challenge }).set(attrs)` (`qr-admin.ts:408`) — an omitted key is a **no-clobber**, so the stored `scoreWindow` map survives untouched.

Result: the judge keeps gating the flag on the old window, but `CtfForm.tsx:729` renders "Scorable any time." — the UI actively tells the operator the flag is open when it is not. The only escape (delete + recreate) is buried in a code comment (`CtfForm.tsx:312-315`), never surfaced to the user. "Omit the key" was conflated with "clear the value"; that equivalence only holds on create, not on edit.

**Fix:** On edit, an explicit disable must emit an attribute *removal*, not an omission. Introduce a sentinel through the layers and a `.remove()` on patch. Sketch:

```ts
// CtfForm.onSave — send an explicit clear when editing an existing gated flag:
const clearWindow = isEdit && !windowEnabled && Boolean(initial?.scoreWindow);
const ctf = {
  ...,
  ...(scoreWindow ? { scoreWindow } : clearWindow ? { scoreWindow: null } : {}),
};

// CtfInput: scoreWindow?: { ... } | null;

// ctfAttributes should NOT fold a null into the .set() payload; instead return a
// removal directive, and upsertCtf applies it:
if (input.scoreWindow === null) {
  await Ctf.patch({ challenge }).set(attrs).remove(["scoreWindow"]).go();
} else {
  await Ctf.patch({ challenge }).set(attrs).go();
}
```

(Confirm ElectroDB `.remove()` chaining semantics for the map attribute; the entity marks `scoreWindow` optional with no default, so removal is legal.)

## Warnings

### WR-01: Overnight (`to < from`) and degenerate (`from===to`, empty `days`, empty times) windows are silently unsupported — no validation, flag never scores

**File:** `apps/run.human/webapp/src/lib/ctf-score-window.ts:116` (and the missing guard in `qr-admin.ts:333-383` / `CtfForm.tsx:680-723`)

**Issue:** The predicate is a single lexicographic comparison `local >= window.from && local < window.to` (ctf-score-window.ts:116). For any window where `to <= from` this is unsatisfiable, so a natural CTF "run hours" overnight window like `22:00–02:00` evaluates to `false` at **every** instant — the flag can never score. The same silent never-score happens for `from === to`, an empty `days` array (`days.includes(...)` is always false, line 110), or enabled-with-empty times (`from=""`,`to=""` → `local >= "" && local < ""` → always false). Nothing rejects or warns on any of these: `ctfAttributes` validates `timeTiers` but passes `scoreWindow` through verbatim (`qr-admin.ts:380`), the entity map has no constraints, and the `type="time"` inputs in `CtfForm.tsx` (:686-704) freely allow `to < from` and can be saved with zero days. Because the failure is fail-closed (deny), there is no incorrect award — but the operator gets a permanently non-scoring flag with no feedback, and the UI (`Live scoring preview`) still shows a positive point value.

**Fix:** Either (a) support wrap-around explicitly — `from <= to ? (local >= from && local < to) : (local >= from || local < to)` in `isWithinScoreWindow`, plus tests — or (b) reject the misconfiguration at the write boundary. Given the design comment declares the window half-open and same-day, option (b) is the lower-risk choice: add a `scoreWindow` validator to `ctfAttributes` (mirroring the `timeTiers` guard) that throws `QrValidationError` when enabled and `days` is empty, `from`/`to` are not well-formed `HH:MM`, or `to <= from`; and surface the same check inline in `CtfForm.onSave` before POST. Pick one and document the chosen semantics next to `isWithinScoreWindow`.

### WR-02: Lossy timezone round-trip on edit — a stored IANA zone outside PT/ET/UTC is silently rewritten to UTC

**File:** `apps/run.human/webapp/src/components/admin/ctf-form-model.ts:278` (with `:265` and `CtfForm.tsx:183-188,316-322`)

**Issue:** `scoreWindowToFormState` collapses the stored IANA `tz` to a PT/ET/UTC **label**, falling back to `"UTC"` for anything not in `TZ_OPTIONS` (`ctf-form-model.ts:278`). On save, `formStateToScoreWindow` maps that label back to the `"UTC"` IANA id (`:265`). So editing a flag whose stored window is, e.g., `America/Chicago` and saving without touching the dropdown silently rewrites the zone to `UTC` — a real change to when the flag scores. Today the form only ever writes the three `TZ_OPTIONS` zones (and `DEFCON_RUN_HOURS` is `America/Los_Angeles` = PT), so this is currently latent; but `qr-admin.ts` and `narrowCtf` pass any `tz` string through verbatim, so a seeded/imported/hand-written row with another zone would be corrupted on the first admin save with no warning.

**Fix:** Preserve the original IANA id in the form state rather than collapsing it to a label. Carry the raw `tz` alongside `tzLabel` in `ScoreWindowFormState` and prefer it on save when the label is the fallback, e.g.:

```ts
export interface ScoreWindowFormState { ...; tzLabel: string; tz?: string }
// scoreWindowToFormState: keep w.tz; set tzLabel = mapped ?? ""(unknown)
// formStateToScoreWindow: const tz = TZ_OPTIONS.find(o => o.label === state.tzLabel)?.tz ?? state.tz ?? "UTC";
```

Alternatively, render the raw IANA id as a read-only chip when it is outside the three options so the operator sees (and consciously keeps/changes) it.

## Info

### IN-01: Duplicated `(3)` step label / out-of-order numbering in the judge

**File:** `apps/run.human/webapp/src/lib/ctf-judge.ts:285,314`

**Issue:** The scoring-window gate is commented `(3)` (line 285) but is positioned before the attempt-cap gate commented `(2)` (line 300), and the answer-validation block is ALSO commented `(3)` (line 314). Two steps share the label `(3)` and the numbering no longer matches execution order, which will mislead a future maintainer reasoning about gate ordering (the ordering itself is correct). Renumber the flow comments to reflect the actual sequence (load → unlock → window → attempt-cap → validate).

### IN-02: Weekday index↔label mapping duplicated across the module and the form

**File:** `apps/run.human/webapp/src/components/admin/CtfForm.tsx:97` and `apps/run.human/webapp/src/lib/ctf-score-window.ts:65`

**Issue:** `WEEKDAY_LABELS` in the form (index→"Sun".."Sat") and `WEEKDAY_INDEX` in the shared module ("Sun".."Sat"→index) encode the same `getDay` convention in two independent places. They agree today, but a future edit to one without the other would drift the picker's day set out of alignment with the predicate. Since `ctf-score-window.ts` is already the shared client-safe source of truth (it exports `TZ_OPTIONS`, `DEFCON_RUN_HOURS`), export a single `WEEKDAY_LABELS` (or a `weekdayIndex`/`weekdayLabel` pair) from there and consume it in `CtfForm.tsx`.

---

_Reviewed: 2026-07-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
