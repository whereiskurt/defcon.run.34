---
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
plan: 04
subsystem: run.gpx / gpx-studio frontend
tags: [svelte5, legacy-mode, dialog, my-maps, a11y, tooltip-removal, cloud]
status: complete
requires:
  - DialogShell
  - Section
  - "data-hint"
  - "data-dc34-dialog"
provides:
  - "My Maps on the 420px shared dialog shell (dialogId=mymaps)"
  - "MY FILES section above SHARED WITH YOU, with a header overflow menu"
  - "handleExportFile (per-file GPX download)"
  - "data-file-row"
  - "zero native hover tooltips in CloudStorage.svelte"
affects:
  - 70-06
tech-stack:
  added: []
  patterns:
    - "Runes-mode kit components consumed from a legacy-mode host — Svelte 5 mode is per-file, and {#snippet} is template syntax available in both"
    - "Nested plain-variant Section per con-day group inside the MY FILES card"
    - "Row actions revealed by opacity-0 + group-hover/row + group-focus-within/row, forced visible under [@media(hover:none)]"
    - "Per-file export reuses the credentialed loadFromCloud read plus a client-side Blob, so no storage URL reaches the DOM"
key-files:
  created: []
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte
decisions:
  - "The footer snippet lives on the shell, so the Add run button is present on the unauthenticated gate screen too — a deliberate consequence of DialogShell taking footer as a prop rather than a conditional child"
  - "All six row-menu labels are wrapped in a span, giving one consistent label idiom instead of mixing bare text with spans"
  - "Folder rows adopt the file-row 17px glyph and semibold name so the two row kinds read as one vocabulary"
  - "The con-day group card wrapper (border rounded-md divide-y) was dropped — the MY FILES Section card already supplies the surface"
metrics:
  duration: ~35m
  completed: 2026-07-30
  tasks: 3
  files: 1
---

# Phase 70 Plan 04: My Maps on the Shared Dialog Shell Summary

The My Maps dialog is now a 420px carded shell with MY FILES above SHARED WITH
YOU, a header overflow menu, labelled row actions behind one visible `Edit`
button, a real footer, and not a single native hover tooltip left in the file.

## What Was Built

**Shell.** `Dialog.Root` / `Dialog.Content` / `Dialog.Header` (the old 820px
`!max-w-[820px] !w-[90vw]` sheet) are gone, replaced by one `<DialogShell>` call
with `dialogId="mymaps"`, `heading="My Maps"` and a breadcrumb-aware
`subheading` — it reads `Your DEF CON run folder` at the root and the current
folder name once you navigate into one, which is exactly the location text the
deleted toolbar row used to show. A `{#snippet icon()}` supplies the 17px cloud
glyph.

**Body order.** The two unauthenticated branches are preserved verbatim (copy
and classes untouched), then the breadcrumb strip, then the error banner, then
`MY FILES`, then `SHARED WITH YOU`. The breadcrumb strip is the only way back
out of a folder you navigated into, so it survived the toolbar deletion; the
floating new-folder/refresh icon pair did not.

**MY FILES.** A `Section` carrying `count={$cloudFiles.length}` and a
`{#snippet menu()}` overflow menu with three items: `New folder`, `Refresh`
(keeping the spinner/refresh glyph swap) and `Export all`. Its body is the
create-folder input row, the user folder rows, one plain-variant nested
`Section` per con-day group, and the untouched empty state.

**File rows.** The five-icon strip is gone. Each row now shows a 17px map glyph,
a semibold truncating name with the optional emerald submitted badge, an 11px
meta line, and a trailing action cluster holding one labelled `Edit` button plus
an overflow menu: `Share` (or `Manage sharing` when the file already has
shares), `Assign day`, `Save as Route`, `Export GPX`, a conditional
`Version history` submenu, then a separator and a destructive-variant `Delete`.
The whole cluster sits inside a `stopPropagation` wrapper — mandatory, because
the row itself loads the file onto the map.

**Per-file export.** `handleExportFile` reads through `loadFromCloud`, the same
credentialed endpoint the row click already uses, appends `.gpx` when the
filename lacks it, and hands a client-side Blob to `FileSaver.saveAs`. No new
dependency: `file-saver` is already a studio dependency used by
`export/utils.svelte.ts`.

**Folder rows.** Shared folders get a blue globe glyph, a semibold name, an
uppercase pill and a chevron affordance. User folders keep both branches
(inline-rename and display) but the display branch now matches the file-row
shell, and its rename/delete buttons moved into the same hover-reveal wrapper.

**Footer.** Quiet `GPX up to 10mb` on the left, primary `👟 Add run` on the
right. The glyph is the locked CONTEXT.md decision, marked decorative so screen
readers announce the button as `Add run`. The old outline `Export` button left
the footer for the header menu. `Footprints` was dropped from the icon imports
once nothing referenced it.

## Why the file is still legacy mode

`CloudStorage.svelte` is not a runes component and ~30 plain-`let` reactive
bindings depend on that. Every new piece of state in this plan is a plain
`let` (`myFilesCollapsed`, `sharedCollapsed`, `dayCollapsed`) and the per-day
toggle does an explicit `dayCollapsed = dayCollapsed` reassignment as
legacy-mode invalidation insurance. Consuming the runes-mode kit from here is
safe because Svelte 5 mode is decided per file, and `{#snippet}` is plain
template syntax available in both modes. A zero-match grep for the four rune
names ran at every task and stayed at zero.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Row-menu labels wrapped in spans so the label gate is satisfiable**

- **Found during:** Task 2
- **Issue:** The acceptance gate counts lines matching
  `>(Share|Manage sharing)<` and `>Delete<` — it requires the label text to be
  delimited by tags on both sides. The natural markup for a menu item is a glyph
  component followed by bare text on its own line, which puts a newline (not a
  `<`) after the label and matches neither alternative. Writing the two labels
  as bare text would have failed a gate on otherwise-correct markup.
- **Fix:** every row-menu label is wrapped in a `<span>`. Applied to all six for
  consistency rather than only the two the gate names, so the menu has one label
  idiom instead of two.
- **Files modified:** `CloudStorage.svelte`
- **Commit:** a7a43567

### Intentional behavior change (consequence of the plan's own footer spec)

The plan puts the footer on the shell as a `{#snippet footer()}`. `DialogShell`
takes `footer` as a prop and renders it unconditionally, so `Add run` and the
helper text are now visible on the unauthenticated and access-denied gate
screens, where the old in-`{:else}` footer was not. `openAddRun` only closes
this dialog and opens the QuickStart hub, so nothing privileged is exposed. Left
as specified rather than hand-rolling a conditional footer.

### Intentional structural change (covered by the plan's template spec)

The con-day groups lost their `<div class="border rounded-md divide-y">`
wrapper. The plan specifies the group as a nested plain-variant `Section` inside
the MY FILES card, and a card inside a card double-borders; the MY FILES
`Section` already supplies the surface. Row separation now comes from the
hover background rather than divide rules.

## Authentication Gates

None.

## Verification Results

| Gate | Result |
|------|--------|
| Baseline `svelte-check` before any edit | 30 ` ERROR ` lines, 0 on `CloudStorage.svelte` |
| Task 1 / 2 / 3 `svelte-check` | `OK: 0 new errors (total 30)` at each commit |
| Final `svelte-check` | `OK (total 30)` — 0 matching `CloudStorage.svelte` |
| Native hover tooltip attribute | `grep -c` → **0** |
| Raw-HTML interpolation (T-70-01) | `{@html` → 0 |
| Runes in a legacy file (T-70-11) | 0 at all three commits |
| New npm dependencies (T-70-03) | `package.json` / `package-lock.json` porcelain empty |
| Own-files scope | only `cloud/CloudStorage.svelte`; clean after each commit |
| Negative gates on untouched files | `cloud-sync.ts`, `LayerTree`, `LayerTreeNode`, `LayerControlSettings`, `public-overlays.ts`, `my-con-runs.ts`, `community-routes.ts`, `src/routes` → all clean |
| Post-commit deletion check | zero deletions across all three commits |
| Untracked files after task 3 | none |

Per-task grep criteria, all passing:

- **Task 1** — runes 0, `<DialogShell` 1, `dialogId="mymaps"` 1,
  `heading="My Maps"` 1, `label="My files"` at line 600 **before**
  `label="Shared with you"` at line 934, `Your DEF CON run folder` 1,
  `subheading=` 1, `GPX up to 10mb` 1, `Add run` 4, `👟` 1,
  `exportAllFiles([])` 1, `No maps here yet` 1, sign-in copy 1, access-denied
  copy 1, `$breadcrumbs` 5, `groupByConDay` 2, `$: isEmpty` 1, `Footprints` 0.
- **Task 2** — `data-file-row` 1, `>Edit<` 1, menu-label lines 8, destructive
  variant 1, `DropdownMenu.Separator` at 929 **before** `Delete` at 935,
  `handleExportFile` 2, `FileSaver` 2, `group-hover/row:opacity-100` 1,
  `group-focus-within/row:opacity-100` 1, `[@media(hover:none)]:opacity-100` 1,
  `e.stopPropagation()` 5, `handleLoadVersion` 2, `fetchVersionHistory` 2,
  `confirm(` 2, runes 0.
- **Task 3** — native tooltip attribute 0, `data-file-row` 3, `aria-label` 11,
  `tracking-[0.06em]` 1, `handleNavigateToFolder` 4, `startFolderRename` 2,
  `handleDeleteFolder` 2, runes 0.

No test runner exists in gpx-studio (`package.json` scripts are
dev/build/preview/check/check:watch/format/lint only), so `svelte-check` plus
the grep gates are the full available verification surface. Rendered behavior —
section order in the DOM, zero `[data-file-row] [title]`, hint-bar text on
hover, the footer button — is covered by the plan-06 Playwright prod probe.

## Known Stubs

None. Every action the old dialog had still works — open, rename, share, assign
day, save as route, version load, delete, add run, export all — plus the new
per-file GPX export.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change.
The one new data read (`handleExportFile`) uses the existing credentialed
`loadFromCloud` call rather than introducing a direct storage fetch.

## Notes for Downstream Plans

- The dialog is selectable in the DOM as `[data-dc34-dialog="mymaps"]`.
- File rows, user folder rows and shared folder rows all carry `data-file-row`,
  so the prod probe's `[data-file-row] [title]` assertion covers all three.
- Every row and the submitted badge carry `data-hint`, so hovering or
  keyboard-focusing them drives the hint bar.
- This file stays legacy mode. Anything added here must be a plain `let` plus
  `$:`.

## Self-Check: PASSED

`CloudStorage.svelte` verified present on disk (1051 lines). All three commit
hashes verified in `git log`: c0f579fb, a7a43567, 40ca3766.
