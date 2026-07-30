---
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
reviewed: 2026-07-30T13:49:41Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/DialogShell.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/HintBar.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Section.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Row.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Chips.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Chip.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/index.ts
  - apps/run.gpx/gpx-studio/website/src/lib/components/StravaStrip.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/PublicOverlays.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/MyConRuns.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/CommunityRoutes.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/BasemapSection.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte
  - apps/run.gpx/gpx-studio/website/src/lib/logic/basemap-tree-pure.ts
  - apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte
findings:
  critical: 2
  warning: 8
  info: 7
  total: 17
status: issues_found
---

# Phase 70: Code Review Report

**Reviewed:** 2026-07-30T13:49:41Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the Phase 70 shared dialog kit (`dialog-shell/`) and the two surfaces rebuilt
on it (Map Layers via `LayerControl.svelte`, My Maps via `CloudStorage.svelte`), plus
the `basemap-tree-pure.ts` helper and the `StravaStrip.svelte` copy change. Diff base
`c9866aa3..HEAD` (`db85b258`, PR #1098).

**What holds up under scrutiny:**

- **Layer lifecycle is genuinely preserved.** `git diff` on `LayerControl.svelte`
  shows the entire `map.onLoad(...)` block (lines 244–339) is byte-identical: every
  `remove()`/`new`/`add()` pair, the `myConRunsAuthUnsubscribe` async-auth
  subscription, the `ghostMode`/`rainbowUnlocked`/`forcedArchIds`/`coffeeUnlocked`/
  `payphonesShown`/`deuceShown` subscriptions, the `style.import.load` one-shot, the
  `quickStartAction` and `myConRunsRefresh` subscriptions, the `onMount`
  `dc34-open-day-assign` bridge with its cleanup, and `setStyle`/`addOverlay`/
  `updateOverlays`/`hasValidTileUrls`. Nothing was dropped. Only the removed pieces —
  `container`, `openLayerControl`/`closeLayerControl`, `cancelEvents`, the
  `svelte:window` `composedPath()` containment handler, and the `Separator`/
  `ScrollArea` imports — went away, and each is genuinely obsoleted by the dialog.
- **No `{@html`** anywhere in the 15 reviewed files (grep-verified). No `eval`, no
  `innerHTML`, no hardcoded credentials, no injection via `fetch` URL construction.
- **`svelte-check` is clean on phase files.** 26 errors / 1 warning repo-wide; all 26
  errors are in untouched upstream files (`LayerTreeNode`, `CustomLayers`,
  `extension-api`, `mapillary`, `sheet-portal`, `FileListNodeLabel`,
  `AlgoliaDocSearch`, `+page.svelte`). The single warning **is** in a phase file
  (see WR-03).
- The reported behavior changes are real and intentional: check-ins master-off
  collapses via the `prevCheckinsVisible` guard rather than unmounting
  (`PublicOverlays.svelte:60-67`), and `MyConRuns.setAllDays` passes `fit = false`
  against a `setDayVisible(conDay, visible, fit = true)` signature that accepts it
  (`my-con-runs.ts:322`).

**Where it does not hold up:** two correctness defects (an unkeyed shared
version-history buffer that can render and action another file's version list; the
unconditional footer creating a live dead-end on the My Maps gate screens), plus a
cluster of regressions from replacing `title=` with a **single-line truncating** hint
bar — the full text of CMS route descriptions and long filenames is now unreachable in
the UI, where the native tooltip used to wrap and show all of it.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Version-history buffer is shared across files and never cleared — a file's submenu can render and action another file's versions

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte:114-117, 382-398, 890-935`

**Issue:** `fileVersions`, `versionHistoryCurrent`, `loadingVersions` and
`loadingVersionsFileId` are module-level singletons shared by every row's
`DropdownMenu.Sub`. `fetchVersionHistory` never resets `fileVersions` before fetching,
and `finally` clears `loadingVersionsFileId = null` unconditionally. The submenu body
only guards with `loadingVersions && loadingVersionsFileId === file.fileId` (line 903)
— once that guard falls false, it renders whatever is in `fileVersions`, with no
check that the list belongs to `file`.

Two reachable paths:

1. **Fetch failure.** Open A's version submenu (loads A). Open B's — `getFileVersions(B)`
   throws, the `catch` only sets `error`, `fileVersions` still holds **A's** list. B's
   submenu now renders A's versions with A's timestamps and a `current` badge from A.
   Clicking one calls `handleLoadVersion(B, <A's version number>)` (line 918).
2. **Overlap.** Submenus open on hover. Sliding across two rows starts B's fetch, then
   A's in-flight fetch resolves → `fileVersions` = A's, `loadingVersionsFileId` = null →
   B's submenu shows A's list for the window until B resolves.

Result: the user loads a version number they never chose. Not destructive
(`handleLoadVersion` does not call `registerCloudLinkedFile`, so no overwrite), but it
silently produces the wrong document, labelled `"<B name> (vN)"`. This pattern was
carried over from the pre-phase code, but the phase moved it from
`DropdownMenu.Root` (one menu per action button) to `DropdownMenu.Sub` inside a shared
per-row `…` menu, which makes the hover-overlap path easier to hit.

**Fix:** key the buffer to the file and clear it on every open.

```svelte
<script lang="ts">
    let versionsForFileId: string | null = null;

    async function fetchVersionHistory(file: CloudFile) {
        if (loadingVersionsFileId === file.fileId) return;
        // Drop any previous file's list up front — never render stale rows.
        fileVersions = [];
        versionsForFileId = null;
        versionHistoryCurrent = 1;
        loadingVersionsFileId = file.fileId;
        loadingVersions = true;
        error = null;
        try {
            const { versions, current } = await getFileVersions(file.fileId);
            fileVersions = versions;
            versionHistoryCurrent = current;
            versionsForFileId = file.fileId;
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load version history';
        } finally {
            loadingVersions = false;
            loadingVersionsFileId = null;
        }
    }
</script>

<!-- and in the submenu body -->
{#if loadingVersions && loadingVersionsFileId === file.fileId}
    …Loading…
{:else if versionsForFileId !== file.fileId || fileVersions.length === 0}
    <div class="px-2 py-3 text-sm text-muted-foreground">No versions found</div>
{:else}
    …
{/if}
```

### CR-02: My Maps footer renders on the sign-in / access-denied gates, and its primary "Add run" button is a silent dead-end

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/DialogShell.svelte:80-88`, `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte:565-569, 581-592, 993-998`

**Issue:** `DialogShell` renders `{#if footer}` with no awareness of body state, and
`CloudStorage` always supplies the footer snippet. So the unauthenticated branch
(line 581) and the access-denied branch (line 587) both show
`GPX up to 10mb` + a filled primary **Add run** button — the most prominent control on
the panel, more prominent than the actual **Sign In** button in the body.

Assessment of the leak question asked in the brief: **no data leak.** The footer text
is a static string; `openAddRun` reads nothing user-scoped. But it is **not merely
cosmetic** — it is a broken control:

```ts
function openAddRun() {
    closeCloudStorage();      // dialog unmounts
    quickStartOpen.set(true); // QuickStartHub only renders when canShow
}
```

`QuickStartHub.svelte:62` gates on `canShow = $isAuthenticated && $hasGpxStudioAccess`
— exactly the two conditions that put the user on the gate screen in the first place.
So on both gates, clicking the primary CTA closes My Maps, opens nothing, and takes the
Sign In affordance off screen with it. Worse, `quickStartOpen` is left latched: the
hub's `subscribe` handler that resets it to `false` also only runs when the hub is
mounted, so the store stays `true` until the component next mounts.

**Fix:** gate the footer on the same condition as the body. Either make the snippet
conditional at the call site (cleanest — `DialogShell` stays dumb):

```svelte
{#snippet footer()}
    {#if $isAuthenticated && $hasGpxStudioAccess}
        <span class="text-[11px] text-muted-foreground">GPX up to 10mb</span>
        <Button onclick={openAddRun}>
            <span class="mr-2 text-[13px] leading-none" aria-hidden="true">👟</span>Add run
        </Button>
    {/if}
{/snippet}
```

…or add an explicit `showFooter?: boolean` prop to `DialogShell` and pass
`showFooter={$isAuthenticated && $hasGpxStudioAccess}`. Either way, also make
`openAddRun` a no-op when `!$isAuthenticated || !$hasGpxStudioAccess` so the store is
never latched.

## Warnings

### WR-01: The hint bar is single-line and truncating, so text that `title=` used to show in full is now unreachable

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/HintBar.svelte:10,14`; `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/PublicOverlays.svelte:152`; `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte:810,817`

**Issue:** `HintBar` is `min-h-[33px]` with the text span at `min-w-0 truncate` — one
line, ellipsised, inside a `!max-w-[420px]` dialog. The strings it must carry are not
short:

- CMS `shortDescription` for each DEF CON route (`hint={m.shortDescription}`). The
  post-deploy probe captured one: `"All four classics - North, East, South, West -
  stitched into one 20K epic."` — that is already well past what fits in ~390px at
  `text-xs`.
- My Maps row hints: `'Open ' + file.fileName + ' on the map' + ' · ' + file.conDay`.

The `title=` attributes these replaced (`PublicOverlays` old line
`title={m.shortDescription ?? ''}`, `CloudStorage` old `title={file.fileName}` on the
name div and `title="Open on the map"` on the row) rendered a **wrapping**, multi-line
native tooltip. The row label itself is also `truncate` (`Row.svelte:67`,
`CloudStorage.svelte:817`), so for a long filename there is now **no** place in the UI
that shows the full string.

**Fix:** let the hint bar wrap to two lines instead of truncating, and drop the fixed
single-line min-height:

```svelte
<div
    data-hint-bar
    class="flex flex-shrink-0 items-start gap-2 border-t bg-black/25 px-4 py-2 text-xs text-muted-foreground min-h-[33px]"
>
    <span class="mt-px font-mono text-[10px] text-primary/70" aria-hidden="true">ⓘ</span>
    <span data-hint-out aria-live="polite" class="min-w-0 line-clamp-2">{text}</span>
</div>
```

`line-clamp-2` keeps the bar bounded (the probe's "no floating tooltip" invariant is
untouched) while recovering ~2× the copy. Separately, restore full-filename access in
My Maps — e.g. put the bare `file.fileName` first in the hint string so the ellipsis
eats the boilerplate suffix rather than the name:
`data-hint={file.fileName + ' — open on the map' + (file.conDay ? ' · ' + file.conDay : '')}`.

### WR-02: `data-hint` is never associated with its control, and the hint is not reset on `focusout`

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/DialogShell.svelte:34-37, 70-78`; `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/HintBar.svelte:14`

**Issue:** The brief asks whether the hint-bar pattern answers to both hover and focus.
It answers to both — `onmouseover` and `onfocusin` are both wired and both bubble, and
`closest('[data-hint]')` correctly resolves from a focused `<input>` up to its wrapping
`<label data-hint>` (`Row.svelte:31-35`) or a `Section` header
(`Section.svelte:39-40`). But the implementation has three real gaps:

1. **No programmatic association.** The hint is only in a `aria-live="polite"` region;
   there is no `aria-describedby` from the checkbox/radio to the hint text. A screen
   reader user who navigates by control (not by tabbing linearly) never gets the
   description, and re-focusing the same row re-announces nothing because the live
   region's text did not change.
2. **The live region fires on `mouseover`.** A sighted screen-magnifier or
   voice-control user moving the mouse across the list triggers a polite announcement
   per row. Live regions should be driven by intentional focus, not pointer travel.
3. **No `onfocusout` reset.** `onmouseleave` resets to `DEFAULT_HINT`
   (line 75), but tabbing out of the body leaves the last row's hint stranded in the
   bar while nothing is hovered or focused — the opposite of the invariant assertion 6
   in the probe checks for.

**Fix:**

```svelte
<div
    data-dialog-body
    class="…"
    onmouseover={readHint}
    onfocusin={readHint}
    onfocusout={(e) => {
        // Only reset when focus actually left the body, not on intra-body moves.
        const next = e.relatedTarget as Node | null;
        if (!next || !(e.currentTarget as HTMLElement).contains(next)) hint = DEFAULT_HINT;
    }}
    onmouseleave={() => (hint = DEFAULT_HINT)}
>
```

and give `HintBar`'s span a stable `id` (`id="dc34-hint-{dialogId}"`) that `Row` /
`Section` can reference via `aria-describedby` on their input when a `hint` is present.
Consider gating `aria-live` behind focus-origin (set a flag in `readHint` from the
event `type`) so mouse travel does not narrate.

### WR-03: `svelte-ignore` in `DialogShell` names the wrong rule, leaving a live a11y warning

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/DialogShell.svelte:69-70`

**Issue:** The comment suppresses `a11y_mouse_events_have_key_events`, but the rule the
compiler actually raises on that `<div>` is `a11y_no_static_element_interactions`.
Verified — `npx svelte-check` reports exactly one warning repo-wide and it is this one:

```
src/lib/components/dialog-shell/DialogShell.svelte:70:9
Warn: `<div>` with a mouseover or mouseleave handler must have an ARIA role
https://svelte.dev/e/a11y_no_static_element_interactions (svelte)
```

So the suppression is dead code *and* the intended suppression never happened. This is
the phase's only compiler warning; it will get lost in the pre-existing 26-error noise.

**Fix:** name the real rule (and keep the other only if it also fires):

```svelte
<!-- svelte-ignore a11y_no_static_element_interactions -->
```

### WR-04: Basemap rows carry no hint, so hovering a row shows "Hover a row for details"

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/BasemapSection.svelte:43-51`

**Issue:** `BasemapSection` renders `Row`s with no `hint` prop. `readHint` walks
`closest('[data-hint]')` upward; the `Section` children wrapper
(`Section.svelte:96`) and the section root (line 38) carry no `data-hint` — only the
section *header* does, and it is a sibling, not an ancestor of the rows. So hovering
any basemap row resolves to `null` and the bar prints the default copy
**"Hover a row for details"** while the user is doing exactly that. The same dead-end
applies to the per-day sub-section headers in `MyConRuns` and to every
`{#each}`-rendered folder/day header in `CloudStorage`.

**Fix:** give the basemap rows a hint, e.g.
`hint={'Use ' + labelFor(id) + ' as the background map style.'}`. For the general case,
make `Section` fall back its own `hint` to its children by putting `data-hint` on the
section root instead of only the header — then an unhinted `Row` inherits its section's
description rather than the "hover a row" placeholder.

### WR-05: Map Layers is now a focus-trapping modal with a full-viewport overlay — the map cannot be panned or zoomed while toggling layers

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/DialogShell.svelte:40-44`; `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte:465-505`

**Issue:** `DialogShell` uses `Dialog.Content` from the local bits-ui wrapper, which
unconditionally renders `<Dialog.Overlay />` — `fixed inset-0 z-50 bg-black/50`
(`ui/dialog/dialog-content.svelte:23`, `ui/dialog/dialog-overlay.svelte:16`) — plus
bits-ui 2.14's modal focus trap and outside-`inert` behavior. The previous Map Layers
surface was an inline hover panel *inside* the mapbox control corner: the map stayed
live underneath, so you could toggle a route on and immediately pan to it.

For a **map layer control** specifically, this breaks the feedback loop the control
exists for: toggle → look → toggle. Every look now costs a dismiss + reopen (and the
reopen re-collapses `basemapCollapsed`, which is `$state(true)`, and re-runs bits-ui's
autofocus onto the Basemap chevron — see the probe's own note that the hint bar reads
"Choose the background map style." on open rather than the default).

Note the phase probe screenshots (`70-06-probes/shot-post-layers.png`,
`shot-post-mymaps.png`) show the map **undimmed** behind the dialog, which does not
match `bg-black/50`; either the capture is mid-animation or something in the deployed
CSS neutralises the overlay. Worth confirming on the live site before deciding the fix
— but the focus trap and outside-`inert` apply regardless of whether the scrim paints.

**Fix:** make the layers dialog non-modal so the map stays interactive, and let
`DialogShell` express that:

```svelte
let { …, modal = true }: { …; modal?: boolean } = $props();

<Dialog.Root {open} {onOpenChange}>
    <Dialog.Content
        …
        showCloseButton={true}
        interactOutsideBehavior={modal ? 'close' : 'ignore'}
        trapFocus={modal}
        preventScroll={modal}
        portalProps={…}
    >
```

and pass `modal={false}` from `LayerControl`, keeping `modal` default-true for My Maps.
(The local `dialog-content.svelte` hard-renders `<Dialog.Overlay />`; suppressing the
scrim needs a `showOverlay` prop there, or a variant wrapper.) At minimum, persist
`basemapCollapsed` across opens so a reopen does not lose the user's place.

### WR-06: The shared kit interpolates an unvalidated `color` straight into `style=`, and one caller feeds it CMS data

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Row.svelte:55-60`; `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Chip.svelte:29-31`; `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/PublicOverlays.svelte:151`

**Issue:**

```svelte
<!-- Row.svelte -->
<span … style="background-color: {color}"></span>

<!-- Chip.svelte -->
style={on && color ? `border-color:${color};background:${color}22;color:${color}` : ''}
```

Svelte HTML-escapes the attribute value, so you cannot break out of `style="…"` into a
new attribute — no XSS. But **CSS declaration injection is open**: a value of
`red;background-image:url(https://attacker/x)` yields a valid extra declaration and an
outbound request (a beacon confirming a specific admin has the layers dialog open), and
`position:fixed;inset:0;z-index:9999` yields a full-panel overlay for clickjacking-ish
mischief.

Reachability today: `Row`'s `color` comes from `m.color`, which is
`m.mapColor || routeColor(routeIndex++)` (`public-overlays.ts:430`) — i.e. the **raw
CMS `mapColor` string**, unvalidated. `Chip`'s `color` currently only ever receives the
hardcoded `TYPE_META` palette. So the live exposure is CMS-admin-only and the pattern
predates this phase (the old `PublicOverlays` had the identical
`style="background-color: {m.color}"`). What is new is that it is now the **public API
of a shared kit** four call sites deep, so the next consumer inherits it silently.

**Fix:** validate at the kit boundary, once.

```svelte
<script lang="ts">
    // Only accept #rgb / #rrggbb / #rrggbbaa; anything else falls back to no tint.
    const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
    const safeColor = $derived(color && HEX.test(color) ? color : undefined);
</script>
{#if safeColor}
    <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style="background-color: {safeColor}"></span>
{/if}
```

Apply the same guard in `Chip`. Optionally also normalise `mapColor` where it enters
the app (`public-overlays.ts:430`) so the bad value never reaches the DOM layer.

### WR-07: Unkeyed `{#each}` over folders and breadcrumbs, alongside rename-in-place state

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte:597, 690, 969`

**Issue:** `{#each $breadcrumbs as crumb, i}`, `{#each $cloudFolders as folder}` and
`{#each $globalFolders as folder}` are all unkeyed, while every sibling loop in the
same file is keyed (`fileGroups as group (group.key)`, `group.files as file
(file.fileId)`). Unkeyed each blocks reuse by identity: when `renameFolder` /
`deleteFolder` / `createFolder` mutates `$cloudFolders` and the server returns a
different order, Svelte patches by index. The `editingFolderId === folder.folderId`
branch (line 698) and the `bind:value={editFolderName}` input then re-bind to whichever
folder now sits at that index — the rename input can visibly jump to the wrong folder
mid-edit, and `saveFolderRename(folder.folderId)` is invoked from a closure over the
*new* row's `folder`.

**Fix:**

```svelte
{#each $cloudFolders as folder (folder.folderId)}
{#each $globalFolders as folder (folder.folderId)}
{#each $breadcrumbs as crumb, i (crumb.id ?? '__root')}
```

### WR-08: Section master checkboxes have no indeterminate state, so partial selections read as "all off"

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Section.svelte:84-92`; `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/MyConRuns.svelte:30-32`; `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/CommunityRoutes.svelte:13-15`

**Issue:** `Section` renders `<input type="checkbox" checked={master}>` with no
`indeterminate` handling. Both derived masters use `every(...)`:

```ts
const allDaysVisible = $derived($myConRunGroups.length > 0 && $myConRunGroups.every((g) => g.visible));
const allVisible     = $derived($communityRoutes.length > 0 && $communityRoutes.every((r) => r.visible));
```

With 4 of 5 con days visible, the "My DEF CON Runs" master renders **unchecked** —
indistinguishable from "everything is off" — and the section label picks up
`opacity-55` (`Section.svelte:68-71`), visually dimming a section that is mostly on.
The same applies to Community Routes and, indirectly, to `PublicOverlays` groups whose
`group.visible` is layer-owned.

**Fix:** widen `master` to a tri-state and drive the DOM property.

```svelte
let { master = null, … }: { master?: boolean | 'partial' | null; … } = $props();

{#if master !== null}
    <input
        type="checkbox"
        checked={master === true}
        indeterminate={master === 'partial'}
        …
        onchange={(e) => onmaster?.(e.currentTarget.checked)}
    />
{/if}
```

then in `MyConRuns`:

```ts
const allDaysVisible = $derived(
    $myConRunGroups.length === 0 ? false
    : $myConRunGroups.every((g) => g.visible) ? true
    : $myConRunGroups.some((g) => g.visible) ? 'partial'
    : false
);
```

Also drop the `opacity-55` dimming when `master === 'partial'`.

## Info

### IN-01: Dead exports in `dialog-shell/index.ts`, and `DEFAULT_HINT` is duplicated as a literal

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/index.ts:2,9`; `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/DialogShell.svelte:28`

**Issue:** Grep across `src/` (excluding the kit itself) shows the only imports from
`dialog-shell/index.js` are `DialogShell`, `Section`, `Row`, `Chips`, `Chip`. `HintBar`
and `DEFAULT_HINT` have zero external consumers. Worse, `DialogShell` does **not**
import the exported constant — it re-declares
`const DEFAULT_HINT = 'Hover a row for details';` locally, so the two copies can drift
and the exported one is what a future consumer (or the prod probe) would read.

**Fix:** delete the `HintBar` re-export (it is an implementation detail of
`DialogShell`), and have `DialogShell` import the single source of truth:
`import { DEFAULT_HINT } from './index.js';` — or move the constant to a
`constants.ts` both files import, to avoid the component↔barrel cycle.

### IN-02: Newly-orphaned destructured settings in `LayerControl`

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte:78-88`

**Issue:** Moving the basemap list into `BasemapSection` orphaned two of the
destructured settings. `previousBasemap` (line 80) and `selectedBasemapTree` (line 83)
now have exactly one occurrence each in the file — the destructure itself.
`currentOverpassQueries` (82) and `selectedOverpassTree` (85) are in the same state but
were already dead before this phase (the Overpass section was removed for DEF CON).

**Fix:** trim the destructure to what is used —
`{ currentBasemap, currentOverlays, selectedOverlayTree, customLayers, opacities }`.

### IN-03: Download filename in `handleExportFile` is unsanitised user input

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte:365-379`

**Issue:** `FileSaver.saveAs(blob, name)` where `name` derives directly from
`file.fileName`, which the user controls via `saveRename` with only a `.trim()`
(line 515). Browsers sanitise the `download` attribute (Chrome strips path separators
and rewrites dangerous extensions), so this is not a traversal primitive — but the
suffix logic can also produce oddities like `run.exe.gpx` and there is no length cap.

**Fix:** normalise before handing it to FileSaver:

```ts
const base = file.fileName.replace(/[\\/:*?"<>| -]/g, '_').slice(0, 200);
const name = base.toLowerCase().endsWith('.gpx') ? base : `${base}.gpx`;
```

### IN-04: ARIA semantics of the kit's group controls

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Chips.svelte:18-32`; `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Section.svelte:89`

**Issue:** (a) `Chips` is a single-select segmented control built from
`<button aria-pressed>`. `aria-pressed` is toggle-button semantics; a screen reader
announces three independent toggles rather than one choice of three. (b) `Section`'s
master checkbox is always labelled `'Toggle all in ' + label`, which reads as
"Toggle all in All Runners" for the `collapsible={false}` aggregate section
(`PublicOverlays.svelte:71-77`) — a single layer toggle, not a group master.

**Fix:** give the `Chips` wrapper `role="radiogroup"` with an `aria-label`, and each
button `role="radio" aria-checked={value === o.key}`. Add an optional
`masterLabel?: string` prop to `Section` so single-toggle sections can say
`'Show All Runners'`.

### IN-05: `Row`'s `trailing` and `icon` snippets render inside the `<label>`

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/dialog-shell/Row.svelte:31-74`

**Issue:** The whole `Row` is a `<label>`, so anything rendered through
`{@render trailing?.()}` (line 73) or `{@render icon()}` (line 63) inherits the
label's implicit activation: a click on a future trailing button would also toggle the
row's checkbox. No current caller passes `trailing`, so this is latent — but it is the
kind of trap that only surfaces after someone adds a per-row action.

**Fix:** either document the constraint in the prop comment, or render `trailing`
outside the label:

```svelte
<div class="flex items-center">
    <label data-layer-row data-hint={hint} class="…flex-1…">…</label>
    {@render trailing?.()}
</div>
```

### IN-06: My Maps "My files" count excludes the folders the same section renders, and the empty state is nested inside it

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte:619-624, 690-762, 953-958`

**Issue:** `count={$cloudFiles.length}` but the section body renders
`$cloudFolders` **and** `fileGroups`. A folder holding ten runs shows as "MY FILES 0"
at the top level. And the `{#if isEmpty}` "No maps here yet." panel now lives *inside*
the `Section`, so a brand-new account sees a card header reading "MY FILES 0" wrapped
around its own empty state.

**Fix:** `count={$cloudFiles.length + $cloudFolders.length}`, and hoist the `isEmpty`
block above the `Section` (rendering the section only when `!isEmpty`).

### IN-07: Collapse-state maps are never pruned

**File:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/PublicOverlays.svelte:14,48`; `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/MyConRuns.svelte:13,17`; `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte:131`

**Issue:** `collapsed`, `prevGroupVisible` and `dayCollapsed` are keyed by
`folderId` / `conDay` / `group.key` and only ever written. When a group disappears
(a run is retagged to another day, a folder is deleted) its entry stays. If the same
key reappears later — e.g. the user re-tags a run back to Thursday — it silently
resurrects the old collapse state, and in `PublicOverlays` the stale
`prevGroupVisible[folderId]` can suppress the first master-off→collapse transition
after the group returns.

**Fix:** prune in the same `$effect` that maintains them:

```ts
$effect(() => {
    const live = new Set($publicOverlayGroups.map((g) => g.folderId));
    for (const k of Object.keys(prevGroupVisible)) if (!live.has(k)) delete prevGroupVisible[k];
    for (const k of Object.keys(collapsed)) if (!live.has(k)) delete collapsed[k];
    for (const group of $publicOverlayGroups) { … }
});
```

---

_Reviewed: 2026-07-30T13:49:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
