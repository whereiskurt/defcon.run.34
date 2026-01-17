# Change: Refactor GPX Cloud Storage Dialog with Multi-Mode Support

## Why

The Cloud Storage dialog currently serves multiple purposes (save, open, browse) but lacks context-aware behavior. Users must manually expand/collapse sections based on their intent. The "Make Copy" button duplicates functionality already provided by the Duplicate feature (Ctrl+D). Opening files requires clicking individual buttons rather than batch selection.

This refactor improves UX by making the dialog context-aware based on how it's opened, adds batch file opening, and streamlines the menu organization.

## What Changes

- **MODIFIED** Cloud Storage dialog: Add mode-aware behavior (save/open/browse modes)
- **MODIFIED** Cloud Storage dialog: Add batch file selection with checkboxes for opening
- **REMOVED** "Make Copy" button from Cloud Storage dialog
- **MODIFIED** File menu: Add "Save As..." and "Open Remote..." items
- **MODIFIED** Menu shortcuts: Ctrl+Shift+K opens Save As dialog, Ctrl+Shift+O opens Open Remote
- **MODIFIED** Dialog title: Context-aware based on mode
- **MODIFIED** Dialog buttons: Mode-appropriate action buttons

## Impact

- **Affected specs**: `gpx-menu-restructure` (extends with new menu items)
- **New spec**: `gpx-cloud-dialog` - Cloud dialog mode behavior
- **Affected code**:
  - `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/utils.svelte.ts`
  - `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte`
  - `apps/run.gpx/gpx-studio/website/src/lib/components/Menu.svelte`

## Dependencies

- Existing Cloud Storage dialog implementation
- Existing menu structure from `add-gpx-versioning-sharing` change
