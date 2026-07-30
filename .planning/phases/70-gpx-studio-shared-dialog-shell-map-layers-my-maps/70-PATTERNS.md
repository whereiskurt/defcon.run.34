# Phase 70: gpx-studio Shared Dialog Shell (Map Layers + My Maps) - Pattern Map

**Mapped:** 2026-07-29
**Files analyzed:** 12 (5 new, 7 modified)
**Analogs found:** 12 / 12
**Root for all paths below:** `apps/run.gpx/gpx-studio/website/src/`

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `lib/components/dialog-shell/DialogShell.svelte` | NEW | component (shell) | request-response (UI state) | `lib/components/cloud/CloudStorage.svelte` lines 545-552, 941-942 | exact (same Dialog.Root/Content/Header idiom) |
| `lib/components/dialog-shell/Section.svelte` | NEW | component (collapse container) | event-driven | `lib/components/map/layer-control/PublicOverlays.svelte` lines 140-170 + `MyConRuns.svelte` lines 30-58 | exact (this IS the collapse+master idiom being unified) |
| `lib/components/dialog-shell/Row.svelte` | NEW | component (row) | event-driven | `PublicOverlays.svelte` lines 173-187 (layer row) / `CloudStorage.svelte` lines 778-806 (file row) | exact |
| `lib/components/dialog-shell/Chips.svelte` (segmented + multi) | NEW | component | event-driven | `PublicOverlays.svelte` lines 83-96 (segmented) & 107-123 (multi-tint) | exact |
| `lib/components/dialog-shell/HintBar.svelte` | NEW | component | event-driven (delegated hover/focusin) | none in codebase — closest delegation precedent = `LayerControl.svelte` lines 350-382 (document-level delegated listener + cleanup) | partial (pattern-match only) |
| `lib/components/map/layer-control/LayerControl.svelte` | mod | container/host | event-driven + lifecycle | itself (lines 245-340 preserved verbatim); dialog host from `CloudStorage.svelte` 545-552 | exact |
| `lib/components/map/layer-control/PublicOverlays.svelte` | mod | component | event-driven | itself | n/a |
| `lib/components/map/layer-control/MyConRuns.svelte` | mod | component | event-driven | `PublicOverlays.svelte` (it already mirrors it) | exact |
| `lib/components/map/layer-control/CommunityRoutes.svelte` | mod | component | event-driven | `MyConRuns.svelte` | exact |
| `lib/components/map/layer-control/LayerTree.svelte` (basemap radios) | mod-or-bypass | component | request-response | `PublicOverlays.svelte` row markup (if replaced by plain radios) | role-match |
| `lib/components/cloud/CloudStorage.svelte` | mod | component (dialog) | CRUD | itself (994 lines, already the dialog) | n/a |
| `lib/components/StravaStrip.svelte` | mod | component | event-driven | itself lines 567-579 | n/a |

`lib/stores/layer-dialog.ts` (NEW, optional) — see Shared Pattern "Open-state store" below; analog `lib/components/cloud/utils.svelte.ts`.

## Confirmed inventory of `lib/components/ui/` primitives

All present. Barrel-import convention is `import * as X from '$lib/components/ui/<x>/index.js'`.

- `dialog/` — `Root, Portal, Overlay, Content, Header, Footer, Title, Description, Trigger, Close` (bits-ui `Dialog`). `dialog-content.svelte` **already renders `Dialog.Portal` + `Dialog.Overlay` + an absolute top-right ✕ close button** (`showCloseButton = true` default, `end-4 top-4`). Base classes: `fixed left-[50%] top-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg … sm:max-w-lg`. Note `p-6` and `gap-4` — the 420px carded dialog will need `!p-0 !gap-0` overrides plus its own header/body/footer padding.
- `dropdown-menu/` — includes `Item` with `variant="destructive"` built in (see Shared Patterns), `Separator`, `Label`, `Content` (portalled, `z-50`), `Trigger`, checkbox/radio items, sub-menus. Portalled Content solves the "menu inside a scrollable body" discretion item for free.
- `scroll-area/` — `ScrollArea` (bits-ui Root+Viewport+Scrollbar), prop `orientation`, `scrollbarYClasses`.
- `separator/` — `Separator`, `bg-border` + `data-[orientation]` sizing.
- Also available and used nearby: `button` (`Button` with `variant="ghost" size="icon"`), `collapsible`, `popover`, `radio-group`, `checkbox`, `tooltip`.

## Pattern Assignments

### `lib/components/dialog-shell/DialogShell.svelte` (NEW — component, UI state)

**Analog:** `lib/components/cloud/CloudStorage.svelte`

**Dialog host pattern** (CloudStorage.svelte lines 545-552, 941-942) — store-driven `open` + `onOpenChange` guard:
```svelte
<Dialog.Root open={$cloudStorageOpen} onOpenChange={(isOpen) => !isOpen && closeCloudStorage()}>
    <Dialog.Content class="!max-w-[820px] !w-[90vw] max-h-[85vh] overflow-hidden flex flex-col">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <Cloud class="h-5 w-5" />
                My Maps
            </Dialog.Title>
        </Dialog.Header>
        ...
    </Dialog.Content>
</Dialog.Root>
```
Copy exactly: the `!`-prefixed width overrides (needed to beat `sm:max-w-lg` in dialog-content), `max-h-… overflow-hidden flex flex-col`, and the icon-in-Title composition. For Phase 70 the sizes become `!max-w-[420px] !w-[94vw] max-h-[72vh]` and add `!p-0 !gap-0` to kill dialog-content's `p-6 gap-4`.

**Scrollable body pattern** (CloudStorage.svelte line 615) — plain overflow, NOT ScrollArea:
```svelte
<div class="mt-2 space-y-2 overflow-y-auto flex-1 min-h-0">
```
Prefer this over `ScrollArea` for the dialog body: `ScrollArea` (used by the old LayerControl popover, line 476) is the bits-ui viewport wrapper and adds a scroll container that interferes with `flex-1 min-h-0` sizing. Use `space-y-2.5` for the ~10px inter-card gap.

**Footer pattern** (CloudStorage.svelte lines 929-939) — hand-rolled, not `Dialog.Footer`:
```svelte
<div class="flex justify-between gap-3 pt-3 flex-shrink-0 border-t mt-2">
    <Button onclick={openAddRun}>
        <Footprints class="h-4 w-4 mr-2" />
        Add run
    </Button>
    ...
</div>
```
Note `Dialog.Footer`'s own class is `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` — wrong for the required "helper text left / primary right", so keep this hand-rolled `justify-between` div (add `flex-shrink-0` so it never scrolls).

**Header subtitle precedent** (`ConDaySaveDialog.svelte` lines 96-101):
```svelte
<div class="flex items-center gap-2">
    <CalendarCheck size={18} class="shrink-0 text-primary" />
    <h2 class="text-base font-semibold">Save as defcon.run Activity</h2>
</div>
<p class="mt-0.5 text-xs text-muted-foreground">Which DEF CON day is this run for?</p>
```
`size={18}` on a lucide icon = the spec's 17px glyph; `text-xs text-muted-foreground` = the muted subtitle token. (ConDaySaveDialog is a HAND-ROLLED fixed-overlay dialog — do NOT copy its overlay/z-index approach; copy only this header composition.)

**Do NOT copy from CloudStorage:** the `title="…"` attributes on rows/buttons (lines 594, 604, 640, 720, 730, 781, 785, 826, 836, 851, 909) — those are exactly what the hint bar replaces.

---

### `lib/components/dialog-shell/Section.svelte` (NEW — collapse container, event-driven)

**Analog:** `lib/components/map/layer-control/PublicOverlays.svelte` lines 140-170 (and its clone `MyConRuns.svelte` 30-58, `CommunityRoutes.svelte` 25-46)

**Chevron + master-checkbox header** (PublicOverlays.svelte lines 144-169) — the markup to unify:
```svelte
<div class="flex flex-row items-center gap-1 font-semibold">
    <button
        type="button"
        class="shrink-0 opacity-70 hover:opacity-100"
        aria-label={collapsed[group.folderId] ? 'Expand' : 'Collapse'}
        onclick={() => (collapsed[group.folderId] = !collapsed[group.folderId])}
    >
        {#if collapsed[group.folderId]}
            <ChevronRight size="16" />
        {:else}
            <ChevronDown size="16" />
        {/if}
    </button>
    <label class="flex flex-row items-center gap-2 grow">
        <input
            type="checkbox"
            checked={group.visible}
            onchange={(e) => layer?.setGroupVisible(group.folderId, e.currentTarget.checked)}
        />
        {group.folderName.replace(/\bMaps\b/, 'Routes')}
    </label>
</div>
```
Preserve: real `<button type="button">` with `aria-label` (spec §7 already satisfied), `checked={…}` + `onchange` (uncontrolled-with-store, NOT `bind:`), the `\bMaps\b → Routes` rename, and the `layer?.` optional call (layer is undefined for the first frame — `$props()` comment at PublicOverlays.svelte line 37-39).
Change per spec: chevron moves to a rotating single icon (`transition-transform duration-150 -rotate-90` when closed) instead of swapping `ChevronRight`/`ChevronDown` nodes; master checkbox moves to the RIGHT of the label; label gets `text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground` and `opacity-55` when master is off.

**MUST-PRESERVE master-collapse effect** (PublicOverlays.svelte lines 48-56) — copy verbatim into Section's consumer, including the comment:
```ts
let prevGroupVisible: Record<string, boolean> = {};
$effect(() => {
    for (const group of $publicOverlayGroups) {
        if (prevGroupVisible[group.folderId] !== group.visible) {
            prevGroupVisible[group.folderId] = group.visible;
            collapsed[group.folderId] = !group.visible;
        }
    }
});
```
`prevGroupVisible` is deliberately a plain object, not `$state` — making it reactive re-triggers the effect and it fights the manual chevron. `MyConRuns.svelte` lines 17-25 is the same code keyed by `conDay`; `CommunityRoutes.svelte` lines 17-20 does the simpler single-group form (`toggleAll` sets `collapsed = !visible`).

**Node-swap landmine (why the old outside-click handler existed)** — `LayerControl.svelte` lines 529-539 comment: swapping the chevron icon node detaches the click target, so `container.contains(e.target)` misreports. Deleting that `svelte:window` handler in favour of the Dialog overlay removes the hazard, and the rotating-single-icon chevron removes the node swap too.

---

### `lib/components/dialog-shell/Row.svelte` (NEW — row, event-driven)

**Layer-row analog** (PublicOverlays.svelte lines 173-187) — including the `title=` to DELETE:
```svelte
{#each group.maps as m (m.fileId)}
    <label class="flex flex-row items-center gap-2" title={m.shortDescription ?? ''}>
        <input type="checkbox" checked={m.visible}
            onchange={(e) => layer?.setRouteVisible(m.fileId, e.currentTarget.checked)} />
        <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style="background-color: {m.color}"></span>
        {m.title || prettyRouteName(m.fileName)}
    </label>
{/each}
```
The `h-2.5 w-2.5 shrink-0 rounded-full` + inline `style="background-color: …"` dot is the established color-dot idiom (also `MyConRuns.svelte` 52-55 and `CommunityRoutes.svelte` 57-60, both using `routeColor(i)` from `$lib/dc34-palette`). Keep it verbatim.
The change: `title={m.shortDescription ?? ''}` → `data-hint={m.shortDescription ?? ''}` plus `data-layer-row` on the row element (UI-SPEC §8 asserts `[data-layer-row] [title]` count === 0).

**File-row analog** (CloudStorage.svelte lines 778-806) — name + meta line + trailing action strip:
```svelte
<div class="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 cursor-pointer"
     onclick={() => handleLoadFile(file)} title="Open on the map">
    <MapIcon class="h-4 w-4 text-primary flex-shrink-0" />
    <div class="min-w-0 flex-1">
        <div class="font-medium text-sm flex items-center gap-1.5" title={file.fileName}>
            <span class="truncate min-w-0">{file.fileName}</span>
        </div>
        <div class="text-xs text-muted-foreground flex gap-2">
            <span>v{file.version || 1}</span>
            <span class="hidden sm:inline">· {formatFileSize(file.fileSize)}</span>
            <span class="hidden sm:inline">· {formatDate(file.updatedAt)}</span>
        </div>
    </div>
```
Preserve: `min-w-0 flex-1` + `truncate min-w-0` truncation pair (removing either breaks truncation in a flex row), the `·`-joined meta line, `flex-shrink-0` on icon and action strip.

**Critical row-action guard** (CloudStorage.svelte lines 807-809) — the whole row is clickable, so every action wrapper must stop propagation:
```svelte
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="flex gap-0.5 flex-shrink-0" onclick={(e) => e.stopPropagation()}>
```
The new `Edit` button + `⋯` DropdownMenu.Trigger must live inside a `stopPropagation` wrapper or opening the menu will also load the file onto the map. Same guard appears at lines 680 and 713 for folder rows.

**Hover-reveal actions** (no existing analog — this is new): use `opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity` with `group/row` on the row and `[@media(hover:none)]:opacity-100` for touch viewports. The `group` + variant idiom is already in the codebase (`LayerControl.svelte` line 447 `class="group …"`).

---

### `lib/components/dialog-shell/Chips.svelte` (NEW — component, event-driven)

**Analog:** `lib/components/map/layer-control/PublicOverlays.svelte`

**Segmented single-select** (lines 83-96) — Hour / Today / Whole con:
```svelte
{#each CHECKIN_WINDOWS as w (w.key)}
    <button
        type="button"
        class="rounded-full px-2 py-0.5 text-xs border transition-colors {$checkinFilters.window === w.key
            ? 'border-primary bg-primary/15 font-semibold'
            : 'border-border hover:bg-accent'}"
        onclick={() => layer?.setCheckInFilters({ window: w.key })}
    >
        {w.label}
    </button>
{/each}
```
Selected state is weight + tint (`font-semibold` + `bg-primary/15`), not colour alone — already satisfies UI-SPEC §7. Keep `border-primary bg-primary/15` as the accent-tint token.

**Multi-select type chips with per-type colour** (lines 107-123) — the tint-with-type-colour rule:
```svelte
{#each CHECKIN_USER_TYPES as t (t)}
    {@const on = $checkinFilters.types.includes(t)}
    <button type="button"
        class="rounded-full px-2 py-0.5 text-xs border transition-colors {on ? 'font-semibold' : 'border-border hover:bg-accent'}"
        style={on
            ? `border-color:${TYPE_META[t].color};background:${TYPE_META[t].color}22;color:${TYPE_META[t].color}`
            : ''}
        onclick={() => toggleType(t)}
    >
        {TYPE_META[t].label}
    </button>
{/each}
```
`${color}22` hex-alpha = the spec's ~13% tint. `TYPE_META` (lines 23-28) already holds the exact spec colours — **reuse this const, do not re-declare**: rabbit `#e6007a`, admin `#f4a240`, wildhare `#00c2b8`, og `#8b5cf6`.

**Filter mutation contract** (lines 31-35) — semantics are DEFERRED/unchanged; call through the layer only:
```ts
function toggleType(t: string) {
    const cur = $checkinFilters.types;
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    layer?.setCheckInFilters({ types: next });
}
```

**Handle-search input** (lines 98-105) — `class="w-full rounded border border-border bg-transparent px-2 py-0.5 text-xs"` with `oninput={(e) => layer?.setCheckInFilters({ match: e.currentTarget.value })}`. Add `focus:border-primary` per spec §3.

**Runner clear chip** (lines 125-134) carries `title="Show all runners"` — delete that `title` and route to the hint bar.

**Chip precedent with disabled/full state** (`ConDaySaveDialog.svelte` lines 123-132) shows the `cursor-not-allowed opacity-40` + `title={full ? 'full' : undefined}` combination if a disabled chip state is needed.

---

### `lib/components/dialog-shell/HintBar.svelte` (NEW — component, event-driven) — NO ANALOG

No hint-bar/description-strip exists. Nearest structural precedent for the delegated listener + cleanup is `LayerControl.svelte` lines 350-382:
```ts
onMount(() => {
    const onDocumentClick = (e: MouseEvent) => {
        const target = (e.target as HTMLElement | null)?.closest?.('[data-dc34-assign]') as HTMLElement | null;
        const fileId = target?.dataset.dc34Assign;
        if (!fileId) return;
        ...
    };
    document.addEventListener('click', onDocumentClick);
    return () => { document.removeEventListener('click', onDocumentClick); };
});
```
Copy this shape for the hint bar: one `mouseover` + one `focusin` listener on the dialog body element (not `document`), `(e.target as HTMLElement).closest('[data-hint]')?.dataset.hint`, fall back to `'Hover a row for details'` on `mouseleave`/null. The `?.closest?.()` optional-call defensiveness and the `onMount` return-cleanup are the conventions to match. Styling: `border-t px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5 flex-shrink-0` (matches the footer's `border-t` + muted-meta tokens).

---

### `lib/components/map/layer-control/LayerControl.svelte` (modified — container/host)

**PRESERVE VERBATIM — do not touch these ranges** (all script, zero presentation):
| Lines | What |
|---|---|
| 1-41 | import block (add `* as Dialog` and the dialog-shell imports; do not remove existing) |
| 43-136 | `darkBasemapFor`, `setStyle()`, the mode-tracking `$effect` |
| 138-243 | `hasValidTileUrls`, `addOverlay`, `updateOverlays` + its `$effect` |
| **245-340** | the entire `map.onLoad` block — OverpassLayer, PublicOverlaysLayer, MyConRunsLayer, CommunityRoutesLayer, the `isAuthenticated.subscribe` async-auth load (lines 271-280), Ghost/Rabbit/RainbowArch/CoffeeCup/TheSpot/PayPhone/Deuce instantiation + their one-shot `.subscribe(…)` calls, and the `style.import.load` first-only hook |
| 342-382 | `onMount` document-click → `dc34-open-day-assign` bridge |
| 384-391 | `hasOverlays` `$derived` |
| 421-444 | `myConRunsRefresh.subscribe` reload + one-shot `myConRunsReveal` capture |
| 542-549 | the `{#if assignDialogFile}<ConDaySaveDialog …>` bridge |

The `.subscribe()` calls without cleanup are intentional — the comment at lines 284-286 documents why (`map.onLoad` callbacks fire exactly once and LayerControl mounts once at app root). Do not "fix" them.

**DELETE (the stutter fix):** lines 447-527's hover wiring — `onmouseenter={openLayerControl}`, `onmouseleave={closeLayerControl}`, the `onpointerenter` + `cancelEvents` block (lines 454-462), the `cancelEvents` state (line 400), the grid-rows/grid-cols reveal transition (lines 464-475), and the whole `<svelte:window on:click=…>` outside-click handler (lines 529-540) with its now-obsolete `container` binding.

**KEEP the CustomControl wrapper** for map-corner placement; the trigger becomes a click-only button. Analog for a click-triggered CustomControl button: `lib/components/map/spot-control/SpotControl.svelte` lines 50-60:
```svelte
<CustomControl class="w-[29px] h-[29px] shrink-0">
    <ButtonWithTooltip variant="ghost" class="w-full h-full" side="left"
        label="The Spot — LVCC rally point, 0600" onclick={flyToSpot}>
        <span class="text-[17px] leading-none select-none" aria-hidden="true">🚨</span>
    </ButtonWithTooltip>
</CustomControl>
```
Note `CustomControl.svelte` (lines 32-36) renders `bg-background rounded shadow-md` and the control's DOM lives inside the mapbox corner container — so the Dialog must be rendered as a SIBLING of `<CustomControl>` in the template, not inside it (bits-ui `Dialog.Portal` already escapes to `<body>`, so this is safe either way, but sibling placement keeps the control markup clean). `+page.svelte` lines 143-144 mount order (`<SpotControl />` then `<LayerControl />`) is unchanged.

**quickStartAction bridge** (lines 407-419) — keep the whole subscription; only its two `open = true` lines now target the dialog open state:
```ts
quickStartAction.subscribe((action) => {
    if (!action) return;
    if (action === 'routes' && publicOverlaysLayer) {
        for (const group of get(publicOverlayGroups)) {
            publicOverlaysLayer.setGroupVisible(group.folderId, true);
        }
        open = true;
    } else if (action === 'runners' && rabbitLayer) {
        void rabbitLayer.setVisible(true);
        open = true;
    }
    quickStartAction.set(null);
});
```

**Section conditional-render guards to preserve** (lines 501, 507, 516) — "empty sections stay hidden" is already implemented by these:
`{#if $publicOverlayGroups.length > 0 || $publicAggregate.available}` · `{#if $myConRunGroups.length > 0}` · `{#if $communityRoutes.length > 0}` · `{#if hasOverlays}`.

**Basemap section** (lines 479-489) — `LayerTree` currently renders it. If replaced by plain radio Rows, this callback pair must be preserved:
```svelte
onselect={(value) => {
    $previousBasemap = $currentBasemap;
    $currentBasemap = value;
}}
```
`LayerTree.svelte` is only 31 lines (a `CollapsibleTree` + `LayerTreeNode` wrapper with `min-w-64 mb-1`) and is ALSO used at line 493 for overlays and by `LayerControlSettings` — so replacing the basemap radios with plain Rows must leave `LayerTree.svelte` itself intact.

---

### `lib/components/cloud/CloudStorage.svelte` (modified — component, CRUD)

**Analog:** itself. All 470 lines of script (auth gate, CRUD handlers, `groupByConDay`, formatters) stay; only the template (545-942) is re-hierarchied.

**Legacy-mode landmine:** this component is NOT runes-mode. It uses `let x = …` + `$:` reactive statements (lines 169-175) and the comment at line 79 says so explicitly: *"(legacy-mode component — plain lets are reactive here, no runes)"*. Any new `$state`/`$derived` in this file will force the whole component to runes mode and break the ~30 existing plain-`let` reactive bindings. Either keep using `let` + `$:` here, or convert the file wholesale as a deliberate step.

**⋯ menu pattern** (lines 857-901) — `DropdownMenu` is already imported and used for version history; reuse for both the MY FILES header menu and the per-row menu:
```svelte
<DropdownMenu.Root onOpenChange={(isOpen) => { if (isOpen) fetchVersionHistory(file); }}>
    <DropdownMenu.Trigger
        class="inline-flex items-center justify-center h-7 w-7 rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        disabled={loading}
    >
        <History class="h-3.5 w-3.5" />
        <span class="sr-only">Version history</span>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="w-56">
        <DropdownMenu.Label>…</DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item class="flex justify-between items-center cursor-pointer" onclick={…}>…</DropdownMenu.Item>
    </DropdownMenu.Content>
</DropdownMenu.Root>
```
`DropdownMenu.Trigger` takes a raw class string (it is not a `Button`), hence the long hand-copied button classes — copy that string. `DropdownMenu.Content` is portalled at `z-50`, so it escapes the scrollable dialog body automatically. For the danger Delete item use the built-in variant rather than hand-rolled red: `<DropdownMenu.Item variant="destructive">` (`dropdown-menu-item.svelte` has `data-[variant=destructive]:text-destructive` wired).

**Existing five actions to fold into the menu** (lines 810-912): Rename (`startRename`, `Pencil`), Share (`fileToShare = file; shareDialogOpen = true`, `Share2`), Assign day (`conDayDialogFile = file`, `CalendarCheck`), Save as Route (`routeDialogFile = file` + reset `routeConvertMsg/Err`, `RouteIcon`), Version history (conditional on `(file.versionCount || 1) > 1`), Delete (`handleDeleteFile`, `Trash2`, `text-destructive`). The visible labeled **Edit** button maps to `startRename` (`disabled={loading || editingFileId !== null}`).

**Header ⋯ menu items** replace the floating icon pair at lines 587-612: New folder → `showCreateFolder`, Refresh → `refreshFiles` (keep the `Loader2 animate-spin` swap at 606-610), Export all → `exportAllFiles([])` (currently the footer's second button, lines 935-938 — it leaves the footer).

**Section ordering:** MY FILES = the `{#each fileGroups}` block (lines 740-919) plus `{#each $cloudFolders}` (672-737); SHARED WITH YOU = `{#each $globalFolders}` (658-669), which currently renders FIRST and must move BELOW. Its badge markup (`<span class="text-xs text-muted-foreground">shared</span>` + `<ChevronRight class="h-4 w-4 text-muted-foreground" />`, `Globe class="h-4 w-4 text-blue-500"`) becomes the SHARED pill + `›`.

**Auth gate and empty state to preserve verbatim:** lines 554-565 (`!$isAuthenticated` → Sign In; `!$hasGpxStudioAccess` → access denied) and 921-926 (`isEmpty` copy — UI-SPEC §7 says keep current copy). `isEmpty` derivation is at 171-175.

**Footer:** `openAddRun()` (lines 539-542) already does `closeCloudStorage(); quickStartOpen.set(true);` — unchanged; only the button becomes the accent primary at bottom-right with `Footprints` + "Add run", and helper text "GPX up to 10mb" goes bottom-left.

---

### `lib/components/StravaStrip.svelte` (modified — component, event-driven)

**Analog:** itself, lines 567-579. Copy-only change; `isTagged`/`isUntaggedImport` (lines 192-198) and `openPopover`'s mode selection (lines 203-213, `popoverMode = a.imported ? 'assign' : 'import'`) are UNCHANGED.

Current chip block:
```svelte
{#if tagged}
    <span class="text-[10px] font-semibold text-green-600 dark:text-green-400">
        ✓ {weekdayShort(a.conDay as string)}
    </span>
{:else if untaggedImport}
    <span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-500">
        Assign a day
    </span>
{/if}
```
Change: `Assign a day` → `Pick a day` (keep the amber classes verbatim), and add an `{:else}` arm for never-imported activities with a quiet `+ Import` chip — mirror the type-badge token already on line 564 for the "quiet" look: `rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground`. Both chips are inside the card `<button>` (line 546) whose `onclick={() => openPopover(a)}` already routes to the right mode, so the chips need no handlers of their own.

---

## Shared Patterns

### Open-state store (dialog visibility)
**Source:** `lib/components/cloud/utils.svelte.ts` (whole file, 42 lines)
**Apply to:** the new Map Layers dialog if its open state must be reachable from outside LayerControl
```ts
import { writable } from 'svelte/store';

/** Whether the unified "My Maps" dialog is open. */
export const cloudStorageOpen = writable(false);

/** Open the unified "My Maps" dialog. */
export function openMyMaps(): void { cloudStorageOpen.set(true); }
export function closeCloudStorage(): void { cloudStorageOpen.set(false); }
```
Convention: a `writable(false)` plus named `openX()`/`closeX()` helpers, consumed as `open={$store} onOpenChange={(o) => !o && closeX()}`. `lib/stores/quickstart.ts` is the same convention for one-shot commands (`quickStartAction` / `quickStartOpen`). For Phase 70 the layers `open` can stay local `$state(false)` inside LayerControl since `quickStartAction` already reaches it via subscription — only extract a store if another component needs the trigger.

### Svelte 5 mode: runes vs legacy (CRITICAL — differs per file)
| File | Mode |
|---|---|
| `LayerControl.svelte`, `PublicOverlays.svelte`, `MyConRuns.svelte`, `CommunityRoutes.svelte`, `LayerTree.svelte`, `ConDaySaveDialog.svelte`, `StravaStrip.svelte`, all `ui/` primitives | **runes** — `$state`, `$derived`, `$effect`, `$props`, `$bindable` |
| `CloudStorage.svelte` | **legacy** — plain `let` + `$:` (see its line-79 comment) |
New `dialog-shell/` components: runes.

Runes conventions to match:
- Props: `let { layer }: { layer: PublicOverlaysLayer | undefined } = $props();` (PublicOverlays 39) — always type the destructure inline; optional-chain the layer (`layer?.setX`) because it is undefined for the first frame.
- Bindable prop: `checked = $bindable({})` (LayerTree 12).
- Derived: `let allVisible = $derived($communityRoutes.length > 0 && $communityRoutes.every((r) => r.visible));` (CommunityRoutes 13-15).
- Handlers are attributes, not directives: `onclick=`, `onchange=`, `oninput=`, `onkeydown=`. Only `<svelte:window on:click=…>` uses the legacy `on:` form (LayerControl 530) — and that one is being deleted.
- Store access is still `$store` / `get(store)` from `svelte/store`; layer state lives in stores (`publicOverlayGroups`, `checkinFilters`, `cloudFiles`), NOT in runes.
- Inside an `$effect` that must not re-subscribe, wrap side effects in `untrack(() => …)` (LayerControl 130-136, 239-243).

### Tailwind / theme tokens actually used in this codebase
**Apply to:** every new component
- Surfaces: `bg-background`, `bg-popover`, `bg-muted/20`, `bg-muted/30` (row hover in CloudStorage), `hover:bg-accent` (hover in layer-control), `bg-accent` (quiet chip), `bg-primary/15` (accent tint), `bg-destructive/10` (error banner, CloudStorage 618).
- Text: `text-foreground`, `text-muted-foreground`, `text-primary`, `text-primary-foreground`, `text-destructive`, `text-popover-foreground`.
- Borders: `border` / `border-border`, `border-primary` (selected), `border-t` (footer/hint separators), `bg-border` (Separator).
- Section label: `text-xs font-semibold uppercase tracking-wide text-muted-foreground` (CloudStorage 742, LayerControl 510) → tighten to `text-[11px] tracking-[0.12em] font-bold` per spec.
- Radii: `rounded` / `rounded-md` / `rounded-lg` / `rounded-xl` / `rounded-full` (chips + dots). ~8px card = `rounded-md`; ~14px dialog = `rounded-xl` (ConDaySaveDialog 93 uses `rounded-xl … shadow-2xl` for the heavy-shadow card).
- Icon sizing: lucide `class="h-4 w-4"` / `h-3.5 w-3.5` (CloudStorage) or `size="16"` / `size={18}` (layer-control, ConDaySaveDialog). Both forms are in use; match the neighbouring file.
- Flex truncation: always pair `min-w-0 flex-1` on the growing cell with `truncate min-w-0` on the text span.
- Arbitrary values are used freely (`text-[10px]`, `w-[min(92vw,380px)]`, `z-[70]`, `!max-w-[820px]`) — `!` prefix needed to beat shadcn base classes.
- `cn()` from `$lib/utils.js` is the class-merge helper in every `ui/` primitive; use it in new components that accept a `class` prop.

### Accessibility / svelte-ignore conventions
**Source:** CloudStorage 659, 673, 712, 777, 808; LayerControl 448; ConDaySaveDialog 88-89
Clickable non-button `div`s carry the pragma comment directly above:
```svelte
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
```
Prefer real `<button>` elements in new code (spec §7 requires it for chevrons and chips) — the existing chevrons already are (`type="button"` + `aria-label={collapsed ? 'Expand' : 'Collapse'}`). Icon-only buttons get `<span class="sr-only">…</span>` (CloudStorage 863) or `aria-label=` (CloudStorage 837, 853).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `lib/components/dialog-shell/HintBar.svelte` | component | event-driven | No description-strip / status-line component exists anywhere in gpx-studio; tooltips are today either native `title=` or `ButtonWithTooltip`/`Tooltip.svelte` (floating popovers, which the spec explicitly forbids). Build from the mockup's `mouseover` delegation + the `onMount` delegated-listener shape in LayerControl 350-382. |
| Component tests for any of the above | test | n/a | **gpx-studio has no test runner at all** — `gpx-studio/website/package.json` scripts are `dev/build/preview/check/check:watch/format/lint`; no vitest, no @testing-library, no test dir. `apps/run.gpx/webapp` has vitest (`"test": "vitest run"`, `vitest.config.ts`) but it covers the Next.js webapp, not the Svelte studio. |

**Verification actually available for this phase** (use these, do not invent a test harness):
1. `npm run check` in `apps/run.gpx/gpx-studio/website` = `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`. Baseline is ~26-30 PRE-EXISTING upstream errors; the gate is zero NEW errors on touched files. Capture the baseline BEFORE editing.
2. `./apps/run.gpx/build-frontend.sh` — the only sanctioned way to install gpx-studio deps / build the frontend; a clean build is the compile gate.
3. Pure-logic extraction precedent: `lib/logic/strava-strip-pure.ts` (`guessConDay`, `isUnlimitedQuota`, imported by ConDaySaveDialog 9 and StravaStrip) — if any new logic warrants a unit test, put it in a `*-pure.ts` module, which is the codebase's existing "testable without a component runner" pattern.
4. Post-ship Playwright prod probe per CONTEXT.md — the DOM assertions in UI-SPEC §8 are the acceptance checks.

## Metadata

**Analog search scope:** `apps/run.gpx/gpx-studio/website/src/lib/components/{ui,cloud,map/layer-control,map/custom-control,map/spot-control}`, `lib/stores`, `routes/[[language]]/app`, plus `apps/run.gpx/webapp` for test setup.
**Files read in full:** LayerControl.svelte (549), PublicOverlays.svelte (193), MyConRuns.svelte (77), CommunityRoutes.svelte (67), LayerTree.svelte (31), CloudStorage.svelte (994), ConDaySaveDialog.svelte (189), CustomControl.svelte (38), SpotControl.svelte (60), dialog-content/header/footer/title.svelte, scroll-area.svelte, separator.svelte, dropdown-menu-content/item.svelte, dialog/index.ts, cloud/utils.svelte.ts, stores/quickstart.ts. Targeted reads: StravaStrip.svelte 185-214 and 538-592.
**Pattern extraction date:** 2026-07-29
