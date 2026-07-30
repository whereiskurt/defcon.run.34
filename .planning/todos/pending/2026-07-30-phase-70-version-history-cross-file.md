---
created: 2026-07-30T14:12:00Z
title: "My Maps version history can render one file's versions under another file's row (PRE-EXISTING, widened by Phase 70)"
area: run.gpx
priority: medium
---

Surfaced by the Phase 70 code review as a blocker attributed to Phase 70. **That
attribution is wrong** — the Phase 70 verifier caught it and I confirmed the correction:
`fetchVersionHistory` is **byte-identical** to pre-phase `6fe5cf20:355-371`, as is the
render guard. This bug predates the phase. Recording it because it is real, actionable,
and Phase 70 made it easier to hit.

## The defect

`apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte`

- `fileVersions` (`:114`) is component-level state shared by every file row.
- `fetchVersionHistory` (`:382-398`) never resets it before fetching, and only assigns on
  success (`:390`). On throw, the `catch` sets `error` and leaves the previous file's
  versions in place.
- `loadingVersionsFileId` is cleared in `finally` (`:396`), so the render guard
  `{#if loadingVersions && loadingVersionsFileId === file.fileId}` (`:903`) goes false and
  execution falls through to `{:else if fileVersions.length === 0}` (`:908`) → `{:else}`
  `{#each [...fileVersions].reverse() as ver}` (`:914`).

Sequence: open file A's version submenu (succeeds, `fileVersions` = A's) → open file B's
submenu → B's fetch fails or is slow → **B's row renders A's version list**, and clicking
an entry calls `handleLoadVersion(B, <A's version number>)`. That loads a version number
that may not exist for B, or worse, silently exists and is the wrong content.

## What Phase 70 changed

The trigger moved from a click-only `DropdownMenu.Root` to a bits-ui `Sub` (opens on
pointer-enter). That widens the window — hovering across rows now fires overlapping
fetches where previously a deliberate click was required.

## Fix

Reset `fileVersions = []` and `versionHistoryCurrent = null` at the **top** of
`fetchVersionHistory`, before the `await`. Better: key the cache by `fileId`
(`fileVersions: Record<string, FileVersion[]>`) and have the template read
`fileVersions[file.fileId] ?? []`, which makes the cross-file render structurally
impossible rather than timing-dependent. Also drop the stale list on `catch`.

Related: [[2026-07-30-phase-70-my-maps-footer-gate-regression]] (same review, but that one
IS a Phase 70 regression).
