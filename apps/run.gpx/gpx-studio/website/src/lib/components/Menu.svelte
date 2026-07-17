<script lang="ts">
    import * as Menubar from '$lib/components/ui/menubar/index.js';
    import Shortcut from '$lib/components/Shortcut.svelte';
    import {
        Plus,
        Download,
        Undo2,
        Redo2,
        Trash2,
        Heart,
        Map,
        Layers2,
        Box,
        Milestone,
        Coins,
        Ruler,
        Zap,
        Thermometer,
        Sun,
        Moon,
        Layers,
        ListTree,
        Languages,
        Settings,
        Info,
        File,
        View,
        FilePen,
        PersonStanding,
        Eye,
        EyeOff,
        ClipboardCopy,
        Scissors,
        ClipboardPaste,
        PaintBucket,
        FolderOpen,
        FileStack,
        FileX,
        ChartArea,
        Maximize,
        Cloud,
        RefreshCw,
        Footprints,
    } from '@lucide/svelte';
    import RefreshCueOverlay from '$lib/components/map/RefreshCueOverlay.svelte';
    import { quickStartOpen } from '$lib/stores/quickstart';
    import { isAuthenticated, hasGpxStudioAccess } from '$lib/stores/auth';
    import { map } from '$lib/components/map/map';
    import { editMetadata } from '$lib/components/file-list/metadata/utils.svelte';
    import { editStyle } from '$lib/components/file-list/style/utils.svelte';
    import { exportState, ExportState, exportAllFiles } from '$lib/components/export/utils.svelte';
    import { anySelectedLayer } from '$lib/components/map/layer-control/utils';
    import { defaultOverlays } from '$lib/assets/layers';
    import LayerControlSettings from '$lib/components/map/layer-control/LayerControlSettings.svelte';
    import { ListFileItem, ListTrackItem } from '$lib/components/file-list/file-list';
    import Export from '$lib/components/export/Export.svelte';
    import { CloudStorage } from '$lib/components/cloud';
    import ShareAcceptDialog from '$lib/components/cloud/ShareAcceptDialog.svelte';
    import { cloudStorageOpen, openCloudStorageSave, openCloudStorageOpen, openCloudStorageBrowse, quickSaveToCloud } from '$lib/components/cloud/utils.svelte';
    import { autoSaveManager } from '$lib/auto-save';
    import { mode, setMode } from 'mode-watcher';
    import { i18n } from '$lib/i18n.svelte';
    import { languages } from '$lib/languages';
    import { getURLForLanguage } from '$lib/utils';
    import { settings } from '$lib/logic/settings';
    import {
        createFile,
        fileActions,
        loadFiles,
        pasteSelection,
        triggerFileInput,
    } from '$lib/logic/file-actions';
    import { fileStateCollection } from '$lib/logic/file-state';
    import { fileActionManager } from '$lib/logic/file-action-manager';
    import { copied, selection } from '$lib/logic/selection';
    import { allHidden } from '$lib/logic/hidden';
    import { boundsManager } from '$lib/logic/bounds';
    import { tick } from 'svelte';
    import { allowedPastes } from '$lib/components/file-list/sortable-file-list';

    const {
        distanceUnits,
        velocityUnits,
        temperatureUnits,
        elevationProfile,
        treeFileView,
        currentBasemap,
        previousBasemap,
        currentOverlays,
        previousOverlays,
        distanceMarkers,
        directionMarkers,
        streetViewSource,
        routing,
        autoSaveEnabled,
    } = settings;

    const canUndo = fileActionManager.canUndo;
    const canRedo = fileActionManager.canRedo;

    function switchBasemaps() {
        [$currentBasemap, $previousBasemap] = [$previousBasemap, $currentBasemap];
    }

    function toggleOverlays() {
        if ($currentOverlays && anySelectedLayer($currentOverlays)) {
            [$currentOverlays, $previousOverlays] = [defaultOverlays, $currentOverlays];
        } else {
            [$currentOverlays, $previousOverlays] = [$previousOverlays, defaultOverlays];
        }
    }

    let layerSettingsOpen = $state(false);
</script>

<div class="absolute md:top-2 left-0 right-0 z-20 flex flex-row justify-center pointer-events-none">
    <div
        class="w-fit max-w-[calc(100vw-0.5rem)] flex flex-row flex-wrap items-center justify-center gap-1 p-1 bg-background rounded-b-md md:rounded-md pointer-events-auto shadow-md"
    >
        <!-- Far left: layer refresh countdown pills. Inline in the bar, wraps when
             tight, no z-index so the menu dropdowns render above it. -->
        <RefreshCueOverlay />
        <Menubar.Root class="border-none shadow-none h-fit p-0">
            <Menubar.Menu>
                <Menubar.Trigger aria-label={i18n._('gpx.file')}>
                    <File size="18" class="md:hidden" />
                    <span class="hidden md:block">{i18n._('gpx.file')}</span>
                </Menubar.Trigger>
                <Menubar.Content class="border-none">
                    <Menubar.Item onclick={createFile}>
                        <Plus size="16" />
                        {i18n._('menu.new')}
                        <Shortcut key="+" ctrl={true} />
                    </Menubar.Item>
                    <Menubar.Separator />
                    <Menubar.Item onclick={triggerFileInput}>
                        <FolderOpen size="16" />
                        Local Open
                        <Shortcut key="O" ctrl={true} />
                    </Menubar.Item>
                    <Menubar.Item onclick={openCloudStorageOpen}>
                        <Cloud size="16" />
                        Open Remote...
                        <Shortcut key="O" ctrl={true} shift={true} />
                    </Menubar.Item>
                    <Menubar.Separator />
                    <Menubar.Item onclick={openCloudStorageSave} disabled={fileStateCollection.size == 0}>
                        <Cloud size="16" />
                        Save As...
                        <Shortcut key="K" ctrl={true} shift={true} />
                    </Menubar.Item>
                    <Menubar.Item onclick={quickSaveToCloud} disabled={fileStateCollection.size == 0}>
                        <Cloud size="16" />
                        Save All
                        <Shortcut key="S" ctrl={true} shift={true} />
                    </Menubar.Item>
                    <Menubar.Separator />
                    <Menubar.CheckboxItem bind:checked={$autoSaveEnabled}>
                        <RefreshCw size="16" />
                        Auto-Save
                    </Menubar.CheckboxItem>
                    <Menubar.Separator />
                    <Menubar.Item
                        onclick={() => tick().then(fileActions.deleteSelectedFiles)}
                        disabled={$selection.size == 0}
                    >
                        <FileX size="16" />
                        Close
                        <Shortcut key="⌫" ctrl={true} />
                    </Menubar.Item>
                    <Menubar.Item
                        onclick={fileActions.deleteAllFiles}
                        disabled={fileStateCollection.size == 0}
                    >
                        <FileX size="16" />
                        Close All
                        <Shortcut key="⌫" ctrl={true} shift={true} />
                    </Menubar.Item>
                    <Menubar.Separator />
                    <Menubar.Item
                        onclick={() => exportAllFiles([])}
                        disabled={fileStateCollection.size == 0}
                    >
                        <Download size="16" />
                        Export All...
                    </Menubar.Item>
                </Menubar.Content>
            </Menubar.Menu>
            <Menubar.Menu>
                <Menubar.Trigger aria-label={i18n._('menu.edit')}>
                    <FilePen size="18" class="md:hidden" />
                    <span class="hidden md:block">{i18n._('menu.edit')}</span>
                </Menubar.Trigger>
                <Menubar.Content class="border-none">
                    <Menubar.Item onclick={() => fileActionManager.undo()} disabled={!$canUndo}>
                        <Undo2 size="16" />
                        {i18n._('menu.undo')}
                        <Shortcut key="Z" ctrl={true} />
                    </Menubar.Item>
                    <Menubar.Item onclick={() => fileActionManager.redo()} disabled={!$canRedo}>
                        <Redo2 size="16" />
                        {i18n._('menu.redo')}
                        <Shortcut key="Z" ctrl={true} shift={true} />
                    </Menubar.Item>
                    <Menubar.Separator />
                    <Menubar.Item
                        disabled={$selection.size !== 1 ||
                            !$selection
                                .getSelected()
                                .every(
                                    (item) =>
                                        item instanceof ListFileItem ||
                                        item instanceof ListTrackItem
                                )}
                        onclick={() => (editMetadata.current = true)}
                    >
                        <Info size="16" />
                        {i18n._('menu.metadata.button')}
                        <Shortcut key="I" ctrl={true} />
                    </Menubar.Item>
                    <Menubar.Item
                        disabled={$selection.size === 0 ||
                            !$selection
                                .getSelected()
                                .every(
                                    (item) =>
                                        item instanceof ListFileItem ||
                                        item instanceof ListTrackItem
                                )}
                        onclick={() => (editStyle.current = true)}
                    >
                        <PaintBucket size="16" />
                        {i18n._('menu.style.button')}
                    </Menubar.Item>
                    <Menubar.Item
                        onclick={() => {
                            if ($allHidden) {
                                fileActions.setHiddenToSelection(false);
                            } else {
                                fileActions.setHiddenToSelection(true);
                            }
                        }}
                        disabled={$selection.size == 0}
                    >
                        {#if $allHidden}
                            <Eye size="16" />
                            {i18n._('menu.unhide')}
                        {:else}
                            <EyeOff size="16" />
                            {i18n._('menu.hide')}
                        {/if}
                        <Shortcut key="H" ctrl={true} />
                    </Menubar.Item>
                    {#if $treeFileView}
                        {#if $selection.getSelected().some((item) => item instanceof ListFileItem)}
                            <Menubar.Separator />
                            <Menubar.Item
                                onclick={() =>
                                    fileActions.addNewTrack(
                                        $selection.getSelected()[0].getFileId()
                                    )}
                                disabled={$selection.size !== 1}
                            >
                                <Plus size="16" />
                                {i18n._('menu.new_track')}
                            </Menubar.Item>
                        {:else if $selection
                            .getSelected()
                            .some((item) => item instanceof ListTrackItem)}
                            <Menubar.Separator />
                            <Menubar.Item
                                onclick={() => {
                                    let item = $selection.getSelected()[0];
                                    fileActions.addNewSegment(
                                        item.getFileId(),
                                        item.getTrackIndex()
                                    );
                                }}
                                disabled={$selection.size !== 1}
                            >
                                <Plus size="16" />
                                {i18n._('menu.new_segment')}
                            </Menubar.Item>
                        {/if}
                    {/if}
                    <Menubar.Separator />
                    <Menubar.Item
                        onclick={() => selection.selectAll()}
                        disabled={fileStateCollection.size == 0}
                    >
                        <FileStack size="16" />
                        {i18n._('menu.select_all')}
                        <Shortcut key="A" ctrl={true} />
                    </Menubar.Item>
                    <Menubar.Item
                        onclick={() => {
                            if ($selection.size > 0) {
                                boundsManager.centerMapOnSelection();
                            }
                        }}
                        disabled={$selection.size == 0}
                    >
                        <Maximize size="16" />
                        {i18n._('menu.center')}
                        <Shortcut key="⏎" ctrl={true} />
                    </Menubar.Item>
                    {#if $treeFileView}
                        <Menubar.Separator />
                        <Menubar.Item
                            onclick={() => selection.copySelection()}
                            disabled={$selection.size === 0}
                        >
                            <ClipboardCopy size="16" />
                            {i18n._('menu.copy')}
                            <Shortcut key="C" ctrl={true} />
                        </Menubar.Item>
                        <Menubar.Item
                            onclick={() => selection.cutSelection()}
                            disabled={$selection.size === 0}
                        >
                            <Scissors size="16" />
                            {i18n._('menu.cut')}
                            <Shortcut key="X" ctrl={true} />
                        </Menubar.Item>
                        <Menubar.Item
                            disabled={$copied === undefined ||
                                $copied.length === 0 ||
                                ($selection.size > 0 &&
                                    !allowedPastes[$copied[0].level]?.includes(
                                        $selection.getSelected().pop()!.level
                                    ))}
                            onclick={pasteSelection}
                        >
                            <ClipboardPaste size="16" />
                            {i18n._('menu.paste')}
                            <Shortcut key="V" ctrl={true} />
                        </Menubar.Item>
                    {/if}
                    <Menubar.Separator />
                    <Menubar.Item
                        onclick={() => tick().then(fileActions.deleteSelection)}
                        disabled={$selection.size == 0}
                    >
                        <Trash2 size="16" />
                        {i18n._('menu.delete')}
                        <Shortcut key="⌫" ctrl={true} />
                    </Menubar.Item>
                </Menubar.Content>
            </Menubar.Menu>
            <Menubar.Menu>
                <Menubar.Trigger aria-label={i18n._('menu.view')}>
                    <View size="18" class="md:hidden" />
                    <span class="hidden md:block">{i18n._('menu.view')}</span>
                </Menubar.Trigger>
                <Menubar.Content class="border-none">
                    <Menubar.Item onclick={openCloudStorageBrowse}>
                        <Cloud size="16" />
                        Cloud Storage
                    </Menubar.Item>
                    <Menubar.Separator />
                    <Menubar.CheckboxItem bind:checked={$elevationProfile}>
                        <ChartArea size="16" />
                        {i18n._('menu.elevation_profile')}
                        <Shortcut key="P" ctrl={true} />
                    </Menubar.CheckboxItem>
                    <Menubar.CheckboxItem bind:checked={$treeFileView}>
                        <ListTree size="16" />
                        {i18n._('menu.tree_file_view')}
                        <Shortcut key="L" ctrl={true} />
                    </Menubar.CheckboxItem>
                    <Menubar.Separator />
                    <Menubar.Item inset onclick={switchBasemaps}>
                        <Map size="16" />{i18n._('menu.switch_basemap')}<Shortcut key="F1" />
                    </Menubar.Item>
                    <Menubar.Item inset onclick={toggleOverlays}>
                        <Layers2 size="16" />{i18n._('menu.toggle_overlays')}<Shortcut key="F2" />
                    </Menubar.Item>
                    <Menubar.Separator />
                    <Menubar.CheckboxItem bind:checked={$distanceMarkers}>
                        <Coins size="16" />{i18n._('menu.distance_markers')}<Shortcut key="F3" />
                    </Menubar.CheckboxItem>
                    <Menubar.CheckboxItem bind:checked={$directionMarkers}>
                        <Milestone size="16" />{i18n._('menu.direction_markers')}<Shortcut
                            key="F4"
                        />
                    </Menubar.CheckboxItem>
                    <Menubar.Separator />
                    <Menubar.Item inset onclick={() => map.toggle3D()}>
                        <Box size="16" />
                        {i18n._('menu.toggle_3d')}
                        <Shortcut key="{i18n._('menu.ctrl')} {i18n._('menu.drag')}" />
                    </Menubar.Item>
                </Menubar.Content>
            </Menubar.Menu>
            <Menubar.Menu>
                <Menubar.Trigger aria-label={i18n._('menu.settings')}>
                    <Settings size="18" class="md:hidden" />
                    <span class="hidden md:block">
                        {i18n._('menu.settings')}
                    </span>
                </Menubar.Trigger>
                <Menubar.Content class="border-none">
                    <Menubar.Sub>
                        <Menubar.SubTrigger>
                            <Ruler size="16" class="mr-2" />{i18n._('menu.distance_units')}
                        </Menubar.SubTrigger>
                        <Menubar.SubContent>
                            <Menubar.RadioGroup bind:value={$distanceUnits}>
                                <Menubar.RadioItem value="metric"
                                    >{i18n._('menu.metric')}</Menubar.RadioItem
                                >
                                <Menubar.RadioItem value="imperial"
                                    >{i18n._('menu.imperial')}</Menubar.RadioItem
                                >
                                <Menubar.RadioItem value="nautical"
                                    >{i18n._('menu.nautical')}</Menubar.RadioItem
                                >
                            </Menubar.RadioGroup>
                        </Menubar.SubContent>
                    </Menubar.Sub>
                    <Menubar.Sub>
                        <Menubar.SubTrigger>
                            <Zap size="16" class="mr-2" />{i18n._('menu.velocity_units')}
                        </Menubar.SubTrigger>
                        <Menubar.SubContent>
                            <Menubar.RadioGroup bind:value={$velocityUnits}>
                                <Menubar.RadioItem value="speed"
                                    >{i18n._('quantities.speed')}</Menubar.RadioItem
                                >
                                <Menubar.RadioItem value="pace"
                                    >{i18n._('quantities.pace')}</Menubar.RadioItem
                                >
                            </Menubar.RadioGroup>
                        </Menubar.SubContent>
                    </Menubar.Sub>
                    <Menubar.Sub>
                        <Menubar.SubTrigger>
                            <Thermometer size="16" class="mr-2" />{i18n._('menu.temperature_units')}
                        </Menubar.SubTrigger>
                        <Menubar.SubContent>
                            <Menubar.RadioGroup bind:value={$temperatureUnits}>
                                <Menubar.RadioItem value="celsius"
                                    >{i18n._('menu.celsius')}</Menubar.RadioItem
                                >
                                <Menubar.RadioItem value="fahrenheit"
                                    >{i18n._('menu.fahrenheit')}</Menubar.RadioItem
                                >
                            </Menubar.RadioGroup>
                        </Menubar.SubContent>
                    </Menubar.Sub>
                    <Menubar.Separator />
                    <Menubar.Sub>
                        <Menubar.SubTrigger>
                            <Languages size="16" class="mr-2" />
                            {i18n._('menu.language')}
                        </Menubar.SubTrigger>
                        <Menubar.SubContent>
                            <Menubar.RadioGroup value={i18n.lang}>
                                {#each Object.entries(languages) as [lang, label]}
                                    <a href={getURLForLanguage(lang, '/app')}>
                                        <Menubar.RadioItem value={lang}>{label}</Menubar.RadioItem>
                                    </a>
                                {/each}
                            </Menubar.RadioGroup>
                        </Menubar.SubContent>
                    </Menubar.Sub>
                    <Menubar.Sub>
                        <Menubar.SubTrigger>
                            {#if mode.current === 'light' || !mode.current}
                                <Sun size="16" class="mr-2" />
                            {:else}
                                <Moon size="16" class="mr-2" />
                            {/if}
                            {i18n._('menu.mode')}
                        </Menubar.SubTrigger>
                        <Menubar.SubContent>
                            <Menubar.RadioGroup
                                value={mode.current ?? 'light'}
                                onValueChange={(value) => {
                                    setMode(value as 'light' | 'dark');
                                }}
                            >
                                <Menubar.RadioItem value="light"
                                    >{i18n._('menu.light')}</Menubar.RadioItem
                                >
                                <Menubar.RadioItem value="dark"
                                    >{i18n._('menu.dark')}</Menubar.RadioItem
                                >
                            </Menubar.RadioGroup>
                        </Menubar.SubContent>
                    </Menubar.Sub>
                    <Menubar.Separator />
                    <Menubar.Sub>
                        <Menubar.SubTrigger>
                            <PersonStanding size="16" class="mr-2" />
                            {i18n._('menu.street_view_source')}
                        </Menubar.SubTrigger>
                        <Menubar.SubContent>
                            <Menubar.RadioGroup bind:value={$streetViewSource}>
                                <Menubar.RadioItem value="mapillary"
                                    >{i18n._('menu.mapillary')}</Menubar.RadioItem
                                >
                                <Menubar.RadioItem value="google"
                                    >{i18n._('menu.google')}</Menubar.RadioItem
                                >
                            </Menubar.RadioGroup>
                        </Menubar.SubContent>
                    </Menubar.Sub>
                    <Menubar.Item onclick={() => (layerSettingsOpen = true)}>
                        <Layers size="16" />
                        {i18n._('menu.layers')}
                    </Menubar.Item>
                </Menubar.Content>
            </Menubar.Menu>
        </Menubar.Root>
        <!-- Right: "Add run" (opens the QuickStart hub) — launcher moved here from
             the map corner; auth-gated like the hub itself. -->
        {#if $isAuthenticated && $hasGpxStudioAccess}
            <button
                class="flex items-center gap-1.5 text-primary font-semibold"
                onclick={() => quickStartOpen.set(true)}
                aria-label="Add run"
            >
                <Footprints size="18" />
                <span class="hidden md:block">Add run</span>
            </button>
        {/if}
        <!-- Meshtastic (official mark, icon only) → the DEF CON mesh flasher app. -->
        <a
            href="https://flash.defcon.run"
            target="_blank"
            rel="noopener"
            class="flex items-center rounded px-2 py-0.5 text-green-500 hover:bg-accent hover:text-green-600"
            title="Meshtastic — flash.defcon.run"
            aria-label="Meshtastic (flash.defcon.run)"
        >
            <svg viewBox="0 0 100 55" fill="currentColor" style="height:18px;width:auto" aria-hidden="true">
                <g transform="matrix(0.802386,0,0,0.460028,-421.748,-122.127)">
                    <g transform="matrix(0.579082,0,0,1.01004,460.975,-39.6867)">
                        <path d="M250.908,330.267L193.126,415.005L180.938,406.694L244.802,313.037C246.174,311.024 248.453,309.819 250.889,309.816C253.326,309.814 255.606,311.015 256.982,313.026L320.994,406.536L308.821,414.869L250.908,330.267Z"/>
                    </g>
                    <g transform="matrix(0.582378,0,0,1.01579,485.019,-211.182)">
                        <path d="M87.642,581.398L154.757,482.977L142.638,474.713L75.523,573.134L87.642,581.398Z"/>
                    </g>
                </g>
            </svg>
        </a>
        <div class="flex items-center ml-2 gap-1">
            <a
                href="https://gpx.studio"
                target="_blank"
                class="text-green-500 hover:text-green-600"
                title="Made with love by gpx.studio"
            >
                <Heart size="16" fill="currentColor" />
            </a>
            <span class="font-semibold text-sm hidden md:block">gpx.studio</span>
        </div>
    </div>
</div>

<Export />
<CloudStorage />
<ShareAcceptDialog />
<LayerControlSettings bind:open={layerSettingsOpen} />

<svelte:window
    on:keydown={(e) => {
        let targetInput =
            e &&
            e.target &&
            e.target instanceof HTMLElement &&
            (e.target.tagName === 'INPUT' ||
                e.target.tagName === 'TEXTAREA' ||
                e.target.tagName === 'SELECT' ||
                e.target.role === 'combobox' ||
                e.target.role === 'radio' ||
                e.target.role === 'menu' ||
                e.target.role === 'menuitem' ||
                e.target.role === 'menuitemradio' ||
                e.target.role === 'menuitemcheckbox');

        if (e.key === '+' && (e.metaKey || e.ctrlKey)) {
            createFile();
            e.preventDefault();
        } else if (e.key === 'o' && (e.metaKey || e.ctrlKey)) {
            triggerFileInput();
            e.preventDefault();
        } else if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
            fileActions.duplicateSelection();
            e.preventDefault();
        } else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
            if (!targetInput) {
                selection.copySelection();
                e.preventDefault();
            }
        } else if (e.key === 'x' && (e.metaKey || e.ctrlKey)) {
            if (!targetInput) {
                selection.cutSelection();
                e.preventDefault();
            }
        } else if (e.key === 'v' && (e.metaKey || e.ctrlKey)) {
            if (!targetInput) {
                pasteSelection();
                e.preventDefault();
            }
        } else if ((e.key === 's' || e.key == 'S') && (e.metaKey || e.ctrlKey) && e.shiftKey) {
            // Ctrl+Shift+S: Save All (quick save to cloud)
            if (fileStateCollection.size > 0) {
                quickSaveToCloud();
            }
            e.preventDefault();
        } else if (e.key === 'k' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
            // Ctrl+Shift+K: Save As... (opens Cloud Storage in save mode)
            if (fileStateCollection.size > 0) {
                openCloudStorageSave();
            }
            e.preventDefault();
        } else if (e.key === 'o' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
            // Ctrl+Shift+O: Open Remote... (opens Cloud Storage in open mode)
            openCloudStorageOpen();
            e.preventDefault();
        } else if ((e.key === 'z' || e.key == 'Z') && (e.metaKey || e.ctrlKey)) {
            if (e.shiftKey) {
                fileActionManager.redo();
            } else {
                fileActionManager.undo();
            }
            e.preventDefault();
        } else if ((e.key === 'Backspace' || e.key === 'Delete') && (e.metaKey || e.ctrlKey)) {
            if (!targetInput) {
                if (e.shiftKey) {
                    fileActions.deleteAllFiles();
                } else {
                    fileActions.deleteSelection();
                }
                e.preventDefault();
            }
        } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
            if (!targetInput) {
                selection.selectAll();
                e.preventDefault();
            }
        } else if (e.key === 'i' && (e.metaKey || e.ctrlKey)) {
            if (
                $selection.size === 1 &&
                $selection
                    .getSelected()
                    .every((item) => item instanceof ListFileItem || item instanceof ListTrackItem)
            ) {
                editMetadata.current = true;
            }
            e.preventDefault();
        } else if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
            $elevationProfile = !$elevationProfile;
            e.preventDefault();
        } else if (e.key === 'l' && (e.metaKey || e.ctrlKey)) {
            $treeFileView = !$treeFileView;
            e.preventDefault();
        } else if (e.key === 'h' && (e.metaKey || e.ctrlKey)) {
            if ($allHidden) {
                fileActions.setHiddenToSelection(false);
            } else {
                fileActions.setHiddenToSelection(true);
            }
            e.preventDefault();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            if ($selection.size > 0) {
                boundsManager.centerMapOnSelection();
            }
        } else if (e.key === 'F1') {
            switchBasemaps();
            e.preventDefault();
        } else if (e.key === 'F2') {
            toggleOverlays();
            e.preventDefault();
        } else if (e.key === 'F3') {
            $distanceMarkers = !$distanceMarkers;
            e.preventDefault();
        } else if (e.key === 'F4') {
            $directionMarkers = !$directionMarkers;
            e.preventDefault();
        } else if (e.key === 'F5') {
            $routing = !$routing;
            e.preventDefault();
        } else if (
            e.key === 'ArrowRight' ||
            e.key === 'ArrowDown' ||
            e.key === 'ArrowLeft' ||
            e.key === 'ArrowUp'
        ) {
            if (!targetInput) {
                selection.updateFromKey(
                    e.key === 'ArrowRight' || e.key === 'ArrowDown',
                    e.shiftKey
                );
                e.preventDefault();
            }
        }
    }}
    on:dragover={(e) => e.preventDefault()}
    on:drop={(e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            loadFiles(e.dataTransfer.files);
        }
    }}
/>

<style lang="postcss">
    @reference "../../app.css";

    div :global(button) {
        @apply hover:bg-accent;
        @apply px-3;
        @apply py-0.5;
    }
</style>
