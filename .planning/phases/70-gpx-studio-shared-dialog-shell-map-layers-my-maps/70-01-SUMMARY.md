---
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
plan: 01
subsystem: run.gpx / gpx-studio frontend
tags: [svelte5, runes, shadcn-svelte, dialog, design-system, a11y]
status: complete
requires: []
provides:
  - DialogShell
  - HintBar
  - Section
  - Row
  - Chips
  - Chip
  - DEFAULT_HINT
  - "data-dc34-dialog"
  - "data-dialog-body"
  - "data-hint"
  - "data-hint-bar"
  - "data-hint-out"
  - "data-section"
  - "data-section-chevron"
  - "data-section-label"
  - "data-layer-row"
affects:
  - 70-03
  - 70-04
  - 70-05
  - 70-06
tech-stack:
  added: []
  patterns:
    - "shadcn-svelte Dialog primitives with !-prefixed class overrides to beat sm:max-w-lg / p-6 / gap-4"
    - "Delegated hover+focus hint delegation via Svelte 5 event attributes on the scrollable body"
    - "collapsed as plain input prop + ontoggle callback (never bindable) so consumers keep owning collapse state"
    - "Uncontrolled checkbox/radio (checked= + onchange=) matching PublicOverlays"
key-files:
  created:
    - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/DialogShell.svelte
    - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/HintBar.svelte
    - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Section.svelte
    - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Row.svelte
    - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Chips.svelte
    - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Chip.svelte
    - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/index.ts
  modified: []
decisions:
  - "Header text props are heading / subheading, never the native hover-tooltip attribute spelling, so plans 03-06 can keep a phase-wide zero-count source grep on that spelling"
  - "The barrel grows incrementally across the three task commits instead of forward-referencing files that do not exist yet (deviation Rule 3) — final state is the full six-export barrel"
  - "Plain overflow-y-auto body rather than the bits-ui viewport wrapper, which fights flex-1 min-h-0"
  - "Section performs no cascade and no auto-collapse of its own; onmaster hands the boolean to the consumer so the shipped group-off-collapses effect survives byte-for-byte"
metrics:
  duration: ~25m
  completed: 2026-07-30
  tasks: 3
  files: 7
---

# Phase 70 Plan 01: Shared Dialog Kit Summary

Six presentational Svelte 5 runes components plus a barrel under
`lib/components/dialog-shell/` — one dialog shell, one collapse idiom, one row
vocabulary, one chip vocabulary, and a hint bar that replaces every native hover
tooltip in the Phase 70 surfaces.

## What Was Built

**`DialogShell.svelte`** — the 420px carded dialog. Wraps `Dialog.Root` /
`Dialog.Content` from the existing shadcn-svelte primitives with
`!max-w-[420px] !w-[94vw] !gap-0 !p-0 max-h-[72vh] overflow-hidden flex flex-col
rounded-xl`. The `!` prefixes are load-bearing: `dialog-content.svelte` ships
`sm:max-w-lg`, `p-6` and `gap-4`, all of which must lose to the carded layout.
The built-in close button is deliberately kept (`showCloseButton` left at its
`true` default) because it is absolutely positioned at `end-4 top-4`, which lands
inside the hand-rolled header band — the header carries `pe-10` to reserve that
space.

Four stacked children inside `Dialog.Content`:

1. Hand-rolled header (`Dialog.Header` is `flex-col gap-2`, which fights a single
   row): optional 17px icon snippet, `Dialog.Title` at `text-lg font-bold`, and
   either the muted `Dialog.Description` subheading or an `sr-only` fallback
   description so bits-ui never logs its missing-description warning.
2. The scrollable body: `data-dialog-body`,
   `flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3`, carrying
   `onmouseover` / `onfocusin` / `onmouseleave`.
3. Optional footer, hand-rolled `justify-between` (helper text left, primary
   right) because `Dialog.Footer` is `sm:justify-end`.
4. `HintBar`, always last — below the footer.

`dialogId` is forwarded onto `Dialog.Content` as `data-dc34-dialog` through
`restProps`, giving the prod probe a stable selector.

**`HintBar.svelte`** — a single flex strip: `ⓘ` glyph plus an `aria-live="polite"`
truncating span. `aria-live` matters because the hint bar must serve keyboard
focus, not only mouse hover.

**`Section.svelte`** — the one collapse idiom. A single `ChevronDown` that gains
`-rotate-90` when closed, with `transition-transform duration-150`. Never two icon
components swapped — that node swap is what detaches the click target and forced
the old hand-rolled outside-click containment check to misreport. The uppercase
`tracking-[0.12em]` label is itself a button that toggles collapse and dims to
`opacity-55` when the master checkbox is off. Trailing controls render in the
fixed order count badge (line 79) → overflow menu snippet (line 82) → master
checkbox (line 86, rightmost). `card` variant gets
`rounded-md border bg-muted/20` with a `border-b` under the header when open;
`plain` variant is unstyled.

**`Row.svelte`** — `data-layer-row` on every instance. Checkbox / radio / no
control, the verbatim `h-2.5 w-2.5 shrink-0 rounded-full` colour-dot idiom with a
runtime inline `background-color`, optional icon snippet, a
`min-w-0 flex-1 truncate` label, optional meta, and a trailing snippet.

**`Chips.svelte`** — joined segmented single-select. Each option is a real button
with `aria-pressed`; the selected one gets `bg-primary/15 font-semibold
text-primary`, so selection is weight *and* tint, never colour alone.

**`Chip.svelte`** — one multi-select pill. When on with a type colour it takes the
inline `border-color:${color};background:${color}22;color:${color}` form; the
`22` hex-alpha suffix is the ~13% tint and is already the shipped idiom in
`PublicOverlays.svelte`.

**`index.ts`** — the single import surface. Six named component exports plus
`DEFAULT_HINT`.

## Why heading / subheading

The header text props could naturally have been named after the native hover
tooltip attribute. They are not, on purpose. Plans 03/04/05/06 each gate on a
zero-count source grep for that attribute's exact `name=` spelling in the files
they touch — and those files are exactly the ones that will contain `DialogShell`
call sites. Naming the prop that way would have planted the forbidden spelling in
every call site and turned a real "no native tooltips survive" assertion into a
self-invalidating match on this kit's own API. `heading` / `subheading` keeps
those gates true statements. The kit itself is clean: a recursive
`grep -rcE '(^|[^a-zA-Z-])title=' dialog-shell/` finds zero files.

## Why plain overflow instead of the bits-ui scroll wrapper

The body scrolls with a plain `overflow-y-auto` on a `flex-1 min-h-0` div, which
is what `CloudStorage.svelte` already does. The bits-ui viewport wrapper used by
the old popover introduces its own scroll container that interferes with
`flex-1 min-h-0` sizing inside a `flex flex-col` dialog, so it is not used here.

## Why the hint delegation uses event attributes

`onmouseover` / `onfocusin` / `onmouseleave` are Svelte 5 attributes on the body
element rather than a manual `addEventListener` in `onMount`. Svelte attaches and
detaches them with the portalled node, so there is no cleanup to get wrong when
the dialog unmounts. The handler uses `?.closest?.()` optional-call defensiveness
matching `LayerControl.svelte`'s delegated document listener. A
`svelte-ignore a11y_mouse_events_have_key_events` pragma sits directly above the
element so the mouse handler on a static element adds no new svelte-check finding.

## Why Section owns no cascade

`Section` takes `collapsed` as a plain input prop plus an `ontoggle` callback and
is explicitly *not* bindable. Consumers already own collapse state through their
shipped master-visibility effects (`PublicOverlays.svelte` and its clones), and a
bindable prop would fight those effects. `onmaster` just hands the new boolean
outward; the consumer calls into its layer and lets its own prev-visible effect
drive `collapsed`. That is what preserves today's group-off-collapses behavior
byte-for-byte.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Barrel grown incrementally instead of forward-referencing**

- **Found during:** Task 1
- **Issue:** Task 1's action says to write the complete six-export barrel
  immediately, but `Section.svelte` / `Row.svelte` / `Chips.svelte` /
  `Chip.svelte` do not exist until tasks 2 and 3. `svelte-check` reported four
  real `Cannot find module './Section.svelte' or its corresponding type
  declarations.` errors against `dialog-shell/index.ts`, which the task-1
  `<verify>` gate counts (it greps `dialog-shell`, not a per-file name). Total
  went 30 → 34. The plan's own instruction was therefore unsatisfiable alongside
  its own hard gate.
- **Fix:** Task 1's barrel exports `DialogShell`, `HintBar` and `DEFAULT_HINT`
  only; task 3 completes it with `Section`, `Row`, `Chips` and `Chip` in the same
  commit that creates those files. Every task commit typechecks, and the final
  state on disk is byte-identical to what the plan asked for.
- **Consequence for acceptance:** task 1's criterion "the barrel also names
  HintBar, Section, Row, Chips and Chip" is not true at the task-1 commit, but is
  true at plan end, which is what `<success_criteria>` and `<verification>`
  assert. The hard automated gate (zero new errors) is satisfied at every commit.
- **Files modified:** `dialog-shell/index.ts`
- **Commits:** f0017490 (partial barrel), 6e5e0570 (completed barrel)

**2. [Rule 1 - Bug] Comment text inflated two exact-count grep gates**

- **Found during:** Tasks 1 and 3
- **Issue:** Two acceptance criteria are exact counts, not minimums:
  `grep -c 'aria-live' HintBar.svelte` must be 1 and
  `grep -c 'data-layer-row' Row.svelte` must be 1. Explanatory comments that
  named those tokens pushed each count to 2, failing both gates.
- **Fix:** reworded both comments to describe the attribute without spelling it —
  "Announced politely, so keyboard focus..." and "The row marker attribute
  below...". Same explanation, counts back to 1.
- **Files modified:** `dialog-shell/HintBar.svelte`, `dialog-shell/Row.svelte`
- **Commits:** f0017490, 6e5e0570

Both are the same class of hazard the plan itself warns about in "Gate hygiene:
do not echo rejected constructs into comments" — the gates are plain text counts,
so prose that names a gated token is indistinguishable from code that uses it.
Per that instruction, the rejected constructs (the bits-ui scroll wrapper and the
two-way binding shorthand) are explained in this SUMMARY rather than in code
comments, and neither name appears in any written file.

## Authentication Gates

None.

## Verification Results

| Gate | Result |
|------|--------|
| Baseline `svelte-check` before any edit | 30 ` ERROR ` lines (documented ~26-30 upstream range) |
| Final `svelte-check` after all 7 files | 30 total, **0** matching `dialog-shell` |
| Native tooltip attribute across the kit | `grep -rcE '(^|[^a-zA-Z-])title='` → 0 files |
| Raw-HTML interpolation across the kit | `grep -rc '{@html'` → 0 files (threat T-70-01) |
| New npm dependencies | `git status --porcelain` on `package.json` / `package-lock.json` → empty (threat T-70-03) |
| Negative gates on untouched files | `LayerTree`, `LayerTreeNode`, `LayerControlSettings`, `public-overlays.ts`, `my-con-runs.ts`, `community-routes.ts`, `cloud-sync.ts`, `src/routes` → all clean |
| Own-files scope | only `files_modified` paths appeared under `dialog-shell/` |
| Directory contents | exactly Chip, Chips, DialogShell, HintBar, Row, Section `.svelte` + `index.ts` |
| Post-commit deletion check | zero deletions across all three commits |

Per-task grep criteria all passed: `heading` ≥ 3 (9), `data-dc34-dialog` = 1 bound
to the `dialogId` prop, `!max-w-[420px]` and `!p-0` present, `data-dialog-body` = 1,
`onfocusin` = 1, scroll-wrapper count = 0, `ChevronRight` = 0, `-rotate-90` = 1,
`transition-transform` = 1, `tracking-[0.12em]` = 1, `opacity-55` = 1, binding
shorthand = 0, `aria-label` = 2, `data-section-chevron` / `data-section-label` = 1
each, trailing order count → menu → checkbox confirmed by line number,
`data-layer-row` = 1, colour-dot idiom = 1, truncation pair = 1, `accent-primary`
present, `aria-pressed` = 1 in each chip component, `font-semibold` in Chips,
`}22` hex-alpha in Chip.

No test runner exists in gpx-studio (`package.json` scripts are
dev/build/preview/check/check:watch/format/lint only), so `svelte-check` plus the
grep gates are the full available verification surface for this plan. Visual and
DOM behavior are covered by the post-ship Playwright prod probe in plan 06.

## Known Stubs

None. Every component in this plan is fully implemented; nothing renders yet
because no existing file imports the kit — that wiring is plans 03-05, which is
the intended state at the end of plan 01.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema change —
this plan adds seven presentational frontend files and zero dependencies.

## Notes for Downstream Plans

- Import surface is `$lib/components/dialog-shell/index.js`.
- `DialogShell` requires `open`, `onOpenChange`, `dialogId`, `heading` and a
  `children` snippet; `subheading`, `icon` and `footer` are optional.
- Put `data-hint="..."` on anything whose description should reach the hint bar.
  Anything inside the body works — the delegation uses `closest('[data-hint]')`,
  so hinting a `Section` header hints the whole header row.
- `Section` will not render a chevron unless it is both `collapsible` and has
  `children`; a childless section still reserves the 18px slot so labels stay
  aligned across sections.
- `Section` never cascades. Wire `onmaster` to your layer call and let your
  existing prev-visible effect drive `collapsed`.
- `Row` is the layers/list primitive. My Maps file rows are composed separately in
  `CloudStorage.svelte`, which is a legacy-mode component — do not introduce runes
  there.

## Self-Check: PASSED

All seven files verified present on disk. All three commit hashes verified in
`git log`: f0017490, bbb559fa, 6e5e0570.
