<script lang="ts">
    // Phase 62 — "My Maps": the unified cloud dialog. No more SAVE / OPEN / BROWSE
    // modes (the old CloudStorageMode). It is one view — your DEF CON run folder,
    // your runs grouped by con-day. Opening a map is just clicking it (auto-save
    // persists edits, so there is no Save button). Per-row share / rename / delete
    // / version-history survive; GLOBAL folders show read-only with a globe marker.
    import { onMount } from 'svelte';
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
    import { Button } from '$lib/components/ui/button';
    import { DialogShell, Section } from '$lib/components/dialog-shell/index.js';
    import {
        Cloud,
        Trash2,
        RefreshCw,
        Loader2,
        AlertCircle,
        Pencil,
        Check,
        X,
        Folder,
        FolderPlus,
        ChevronRight,
        Globe,
        Share2,
        Send,
        History,
        Download,
        Map as MapIcon,
        CalendarCheck,
        Route as RouteIcon,
    } from '@lucide/svelte';
    // Path import form, matching the `ui/` primitives.
    import Ellipsis from '@lucide/svelte/icons/ellipsis';
    import ShareDialog from './ShareDialog.svelte';
    import ConDaySaveDialog from './ConDaySaveDialog.svelte';
    import RouteCardForm from './RouteCardForm.svelte';
    import {
        cloudFiles,
        cloudFolders,
        globalFolders,
        currentFolderId,
        breadcrumbs,
        loadFromCloud,
        loadVersionFromCloud,
        getFileVersions,
        deleteFromCloud,
        updateCloudFile,
        createFolder,
        renameFolder,
        deleteFolder,
        navigateToFolder,
        refreshCurrentFolder,
        getApiBase,
        getConDayUsage,
        createRouteFromFile,
        type CloudFile,
        type CloudFolder,
        type FileVersion,
    } from '$lib/cloud-sync';
    import { cloudStorageOpen, closeCloudStorage } from '$lib/components/cloud/utils.svelte';
    import { auth, isAuthenticated, hasGpxStudioAccess } from '$lib/stores/auth';
    import { settings } from '$lib/logic/settings';
    import { fileActions } from '$lib/logic/file-actions';
    import { boundsManager } from '$lib/logic/bounds';
    import { selection } from '$lib/logic/selection';
    import { parseGPX } from 'gpx';
    import { get } from 'svelte/store';
    import { autoSaveManager } from '$lib/auto-save';
    import { quickStartOpen } from '$lib/stores/quickstart';
    import { exportAllFiles } from '$lib/components/export/utils.svelte';
    import FileSaver from 'file-saver';

    let loading = false;
    let error: string | null = null;
    let editingFileId: string | null = null;
    let editFileName: string = '';

    // "Save as route" (routes-vs-runs spec): convert a file/run into a
    // shareable DATELESS route template. Server copies the GPX; the original
    // file (and its con-day/accomplishment, if any) is untouched.
    // (legacy-mode component — plain lets are reactive here, no runes)
    let routeDialogFile: CloudFile | null = null;
    let routeConvertBusy = false;
    let routeConvertMsg: string | null = null;
    let routeConvertErr: string | null = null;

    async function onSaveAsRoute(card: {
        name: string;
        description?: string;
        routeType?: string;
    }) {
        if (!routeDialogFile) return;
        routeConvertBusy = true;
        routeConvertErr = null;
        try {
            await createRouteFromFile(routeDialogFile.fileId, card);
            routeConvertMsg = `Route "${card.name}" created — find it under "Create a route" in the Add run hub, and share it from there.`;
        } catch (e) {
            routeConvertErr = e instanceof Error ? e.message : 'Could not create the route';
        } finally {
            routeConvertBusy = false;
        }
    }

    // Share dialog state
    let shareDialogOpen = false;
    let fileToShare: CloudFile | null = null;

    // Con-day save dialog state (Task 10)
    let conDayDialogFile: CloudFile | null = null;

    // Version history state
    let fileVersions: FileVersion[] = [];
    let versionHistoryCurrent: number = 1;
    let loadingVersions = false;
    let loadingVersionsFileId: string | null = null;

    // Track which files have shares (for colored icon)
    let filesWithShares: Set<string> = new Set();

    // Folder state
    let creatingFolder = false;
    let newFolderName = '';
    let editingFolderId: string | null = null;
    let editFolderName: string = '';

    // Collapse state for the shared-kit sections. Plain lets: this file is legacy mode.
    let myFilesCollapsed = false;
    let sharedCollapsed = false;
    let dayCollapsed: Record<string, boolean> = {};

    // Con-day label/order map, sourced from the authoritative /conday-usage list.
    // Used only to label + order the "My runs" groups; falls back to raw dates.
    let condayLabels: Record<string, string> = {};
    let condayOrder: string[] = [];

    interface FileGroup {
        key: string;
        label: string;
        files: CloudFile[];
    }

    // Group the current folder's files by con-day so "My runs" reads like a con
    // timeline. Con-days come first in usage order (Wed→Mon), then any leftover
    // dates sorted, then an "Other maps" bucket for files with no con-day tag.
    function groupByConDay(
        files: CloudFile[],
        order: string[],
        labels: Record<string, string>
    ): FileGroup[] {
        const byDate = new Map<string, CloudFile[]>();
        const other: CloudFile[] = [];
        for (const f of files) {
            if (f.conDay) {
                if (!byDate.has(f.conDay)) byDate.set(f.conDay, []);
                byDate.get(f.conDay)!.push(f);
            } else {
                other.push(f);
            }
        }
        const groups: FileGroup[] = [];
        const seen = new Set<string>();
        for (const date of order) {
            if (byDate.has(date)) {
                groups.push({ key: date, label: labels[date] ?? date, files: byDate.get(date)! });
                seen.add(date);
            }
        }
        for (const date of [...byDate.keys()].filter((d) => !seen.has(d)).sort()) {
            groups.push({ key: date, label: labels[date] ?? date, files: byDate.get(date)! });
        }
        if (other.length) groups.push({ key: '__other', label: 'Other maps', files: other });
        return groups;
    }

    $: fileGroups = groupByConDay($cloudFiles, condayOrder, condayLabels);

    $: isEmpty =
        $globalFolders.length === 0 &&
        $cloudFolders.length === 0 &&
        $cloudFiles.length === 0 &&
        !creatingFolder;

    onMount(async () => {
        // Check auth and load files on mount
        await auth.checkSession();
        if (get(isAuthenticated) && get(hasGpxStudioAccess)) {
            await refreshFiles();
            void refreshConDayLabels();
        }
    });

    async function refreshConDayLabels() {
        try {
            const usage = await getConDayUsage();
            const labels: Record<string, string> = {};
            const order: string[] = [];
            for (const u of usage) {
                labels[u.date] = u.label;
                order.push(u.date);
            }
            condayLabels = labels;
            condayOrder = order;
        } catch {
            // Labels are cosmetic; fall back to raw dates on failure.
        }
    }

    async function refreshFiles() {
        loading = true;
        error = null;
        try {
            await refreshCurrentFolder();
            // Check which files have shares (in background, don't block UI)
            checkFilesForShares();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load files';
        } finally {
            loading = false;
        }
    }

    // Folder navigation
    async function handleNavigateToFolder(folderId: string | null, folderName?: string) {
        loading = true;
        error = null;
        try {
            await navigateToFolder(folderId, folderName);
            // Update lastSaveFolder so new files auto-save to this folder
            settings.lastSaveFolder.set(folderId ?? 'ROOT');
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to navigate';
        } finally {
            loading = false;
        }
    }

    // Create folder
    function showCreateFolder() {
        creatingFolder = true;
        newFolderName = '';
    }

    function cancelCreateFolder() {
        creatingFolder = false;
        newFolderName = '';
    }

    async function handleCreateFolder() {
        if (!newFolderName.trim()) {
            cancelCreateFolder();
            return;
        }
        loading = true;
        error = null;
        try {
            await createFolder(newFolderName.trim(), get(currentFolderId));
            creatingFolder = false;
            newFolderName = '';
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to create folder';
        } finally {
            loading = false;
        }
    }

    function handleCreateFolderKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            handleCreateFolder();
        } else if (event.key === 'Escape') {
            cancelCreateFolder();
        }
    }

    // Folder rename
    function startFolderRename(folder: CloudFolder) {
        editingFolderId = folder.folderId;
        editFolderName = folder.folderName;
    }

    function cancelFolderRename() {
        editingFolderId = null;
        editFolderName = '';
    }

    async function saveFolderRename(folderId: string) {
        if (!editFolderName.trim()) {
            cancelFolderRename();
            return;
        }
        loading = true;
        error = null;
        try {
            await renameFolder(folderId, editFolderName.trim());
            editingFolderId = null;
            editFolderName = '';
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to rename folder';
        } finally {
            loading = false;
        }
    }

    function handleFolderRenameKeydown(event: KeyboardEvent, folderId: string) {
        if (event.key === 'Enter') {
            saveFolderRename(folderId);
        } else if (event.key === 'Escape') {
            cancelFolderRename();
        }
    }

    // Folder delete
    async function handleDeleteFolder(folder: CloudFolder) {
        if (!confirm(`Delete folder "${folder.folderName}"? It must be empty.`)) {
            return;
        }
        loading = true;
        error = null;
        try {
            await deleteFolder(folder.folderId);
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to delete folder';
        } finally {
            loading = false;
        }
    }

    async function handleLoadFile(file: CloudFile) {
        loading = true;
        error = null;
        try {
            const { content } = await loadFromCloud(file.fileId);
            const gpx = parseGPX(content);
            if (gpx.metadata === undefined) {
                gpx.metadata = {};
            }
            // Use the current fileName from the cloud file list (reflects any renames)
            gpx.metadata.name = file.fileName.replace(/\.gpx$/i, '');
            fileActions.add(gpx);
            selection.selectFileWhenLoaded(gpx._data.id);

            // Center map on the loaded file's bounds
            boundsManager.fitBoundsOnLoad([gpx._data.id]);

            // Register file with auto-save manager (file is now cloud-linked)
            autoSaveManager.registerCloudLinkedFile(
                gpx._data.id,
                file.fileId,
                file.fileName,
                file.folderId ?? null
            );

            closeCloudStorage();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load file';
        } finally {
            loading = false;
        }
    }

    // Per-file GPX download. Deliberately reuses loadFromCloud — the same
    // authenticated endpoint the row click already takes — so no presigned URL or
    // storage key is ever surfaced to the DOM. The blob is built client-side.
    async function handleExportFile(file: CloudFile) {
        loading = true;
        error = null;
        try {
            const { content } = await loadFromCloud(file.fileId);
            const name = file.fileName.toLowerCase().endsWith('.gpx')
                ? file.fileName
                : `${file.fileName}.gpx`;
            FileSaver.saveAs(new Blob([content], { type: 'application/gpx+xml' }), name);
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to export file';
        } finally {
            loading = false;
        }
    }

    // Fetch version history for a file (called when dropdown opens)
    async function fetchVersionHistory(file: CloudFile) {
        if (loadingVersionsFileId === file.fileId) return;

        loadingVersionsFileId = file.fileId;
        loadingVersions = true;
        error = null;
        try {
            const { versions, current } = await getFileVersions(file.fileId);
            fileVersions = versions;
            versionHistoryCurrent = current;
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load version history';
        } finally {
            loadingVersions = false;
            loadingVersionsFileId = null;
        }
    }

    // Check if files have shares (called after loading files)
    async function checkFilesForShares() {
        const newFilesWithShares = new Set<string>();
        for (const file of $cloudFiles) {
            try {
                const response = await fetch(`${getApiBase()}/shares?fileId=${file.fileId}`, {
                    credentials: 'include',
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.shares && data.shares.length > 0) {
                        newFilesWithShares.add(file.fileId);
                    }
                }
            } catch {
                // Ignore errors, just won't show colored icon
            }
        }
        filesWithShares = newFilesWithShares;
    }

    // Format date for version history dropdown (smart relative dates)
    function formatVersionDate(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        const fileDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const timeStr = date
            .toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            })
            .replace(' ', '')
            .toLowerCase();

        if (fileDate.getTime() === today.getTime()) {
            return `Today ${timeStr}`;
        } else if (fileDate.getTime() === yesterday.getTime()) {
            return `Yesterday ${timeStr}`;
        } else {
            const daysAgo = Math.floor(
                (today.getTime() - fileDate.getTime()) / (24 * 60 * 60 * 1000)
            );
            if (daysAgo < 7) {
                const dayName = date.toLocaleDateString(undefined, { weekday: 'short' });
                return `${dayName} ${timeStr}`;
            }
            return (
                date.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                }) + ` ${timeStr}`
            );
        }
    }

    // Load a specific version of a file
    async function handleLoadVersion(file: CloudFile, version: number) {
        loading = true;
        error = null;
        try {
            const { content } = await loadVersionFromCloud(file.fileId, version);
            const gpx = parseGPX(content);
            if (gpx.metadata === undefined) {
                gpx.metadata = {};
            }
            const baseName = file.fileName.replace(/\.gpx$/i, '');
            gpx.metadata.name = `${baseName} (v${version})`;
            fileActions.add(gpx);
            selection.selectFileWhenLoaded(gpx._data.id);
            boundsManager.fitBoundsOnLoad([gpx._data.id]);
            closeCloudStorage();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load version';
        } finally {
            loading = false;
        }
    }

    async function handleDeleteFile(file: CloudFile) {
        if (!confirm(`Delete "${file.fileName}" from cloud storage?`)) {
            return;
        }
        loading = true;
        error = null;
        try {
            await deleteFromCloud(file.fileId);
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to delete file';
        } finally {
            loading = false;
        }
    }

    function startRename(file: CloudFile) {
        editingFileId = file.fileId;
        editFileName = file.fileName;
    }

    function cancelRename() {
        editingFileId = null;
        editFileName = '';
    }

    async function saveRename(fileId: string) {
        if (!editFileName.trim()) {
            cancelRename();
            return;
        }
        loading = true;
        error = null;
        try {
            await updateCloudFile(fileId, { fileName: editFileName.trim() });
            editingFileId = null;
            editFileName = '';
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to rename file';
        } finally {
            loading = false;
        }
    }

    function handleRenameKeydown(event: KeyboardEvent, fileId: string) {
        if (event.key === 'Enter') {
            saveRename(fileId);
        } else if (event.key === 'Escape') {
            cancelRename();
        }
    }

    function formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes}b`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}kb`;
        return `${Math.round(bytes / (1024 * 1024))}mb`;
    }

    function formatDate(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        const fileDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const timeStr = date
            .toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            })
            .replace(' ', '')
            .toLowerCase();

        if (fileDate.getTime() === today.getTime()) {
            return `Today @ ${timeStr}`;
        } else if (fileDate.getTime() === yesterday.getTime()) {
            return `Yesterday @ ${timeStr}`;
        } else {
            const pad = (n: number) => n.toString().padStart(2, '0');
            return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
        }
    }

    // Footer: "+ Add run" hands off to the QuickStart hub (Strava / file doors).
    function openAddRun() {
        closeCloudStorage();
        quickStartOpen.set(true);
    }
</script>

<DialogShell
    open={$cloudStorageOpen}
    onOpenChange={(isOpen) => !isOpen && closeCloudStorage()}
    dialogId="mymaps"
    heading="My Maps"
    subheading={$breadcrumbs.length > 1 ? $breadcrumbs[$breadcrumbs.length - 1].name : 'Your DEF CON run folder'}
>
    {#snippet icon()}<Cloud class="h-[17px] w-[17px]" />{/snippet}

    {#if !$isAuthenticated}
        <div class="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle class="h-12 w-12 text-muted-foreground mb-4" />
            <p class="text-muted-foreground mb-4">You need to sign in to access your maps.</p>
            <Button onclick={() => auth.login()}>Sign In</Button>
        </div>
    {:else if !$hasGpxStudioAccess}
        <div class="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle class="h-12 w-12 text-destructive mb-4" />
            <p class="text-destructive mb-4">Access denied. You need the gpxstudio service.</p>
            <p class="text-muted-foreground text-sm">Contact an admin to request access.</p>
        </div>
    {:else}
        <!-- Breadcrumb strip: the only way back out of a folder you navigated into. -->
        {#if $breadcrumbs.length > 1}
            <div class="flex min-w-0 items-center gap-1 overflow-x-auto px-1 text-sm">
                {#each $breadcrumbs as crumb, i}
                    {#if i > 0}
                        <ChevronRight class="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    {/if}
                    <button
                        class="hover:text-primary hover:underline flex-shrink-0 {i === $breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'}"
                        onclick={() => handleNavigateToFolder(crumb.id, crumb.name)}
                        disabled={loading || i === $breadcrumbs.length - 1}
                    >
                        {crumb.name}
                    </button>
                {/each}
            </div>
        {/if}

        <!-- Error message -->
        {#if error}
            <div class="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
                {error}
            </div>
        {/if}

        <Section
            label="My files"
            count={$cloudFiles.length}
            collapsed={myFilesCollapsed}
            ontoggle={(c) => (myFilesCollapsed = c)}
        >
            {#snippet menu()}
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                        class="inline-flex items-center justify-center h-7 w-7 rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                        disabled={loading}
                        aria-label="My files actions"
                    >
                        <Ellipsis class="h-4 w-4" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content class="w-52" align="end">
                        <DropdownMenu.Item onclick={showCreateFolder}>
                            <FolderPlus class="h-4 w-4" />
                            New folder
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onclick={refreshFiles}>
                            {#if loading}
                                <Loader2 class="h-4 w-4 animate-spin" />
                            {:else}
                                <RefreshCw class="h-4 w-4" />
                            {/if}
                            Refresh
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onclick={() => exportAllFiles([])}>
                            <Download class="h-4 w-4" />
                            Export all
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            {/snippet}

            <!-- Create folder input row -->
            {#if creatingFolder}
                <div class="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/20">
                    <FolderPlus class="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <input
                        type="text"
                        class="border rounded px-2 py-1 text-sm flex-1 min-w-0"
                        placeholder="New folder name"
                        bind:value={newFolderName}
                        onkeydown={handleCreateFolderKeydown}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 text-green-600 hover:text-green-700"
                        onclick={handleCreateFolder}
                        disabled={loading}
                        aria-label="Create folder"
                    >
                        <Check class="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        onclick={cancelCreateFolder}
                        disabled={loading}
                        aria-label="Cancel"
                    >
                        <X class="h-4 w-4" />
                    </Button>
                </div>
            {/if}

            <!-- User folders -->
            {#each $cloudFolders as folder}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div
                    data-file-row
                    data-hint={'Folder — open ' + folder.folderName}
                    class="group/row flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-foreground/5"
                    onclick={() => handleNavigateToFolder(folder.folderId, folder.folderName)}
                >
                    {#if editingFolderId === folder.folderId}
                        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                        <div class="flex items-center gap-2 flex-1" onclick={(e) => e.stopPropagation()}>
                            <Folder class="h-4 w-4 text-amber-500 flex-shrink-0" />
                            <input
                                type="text"
                                class="border rounded px-2 py-1 text-sm flex-1 min-w-0"
                                bind:value={editFolderName}
                                onkeydown={(e) => handleFolderRenameKeydown(e, folder.folderId)}
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                class="h-7 w-7 text-green-600 hover:text-green-700"
                                onclick={(e) => { e.stopPropagation(); saveFolderRename(folder.folderId); }}
                                disabled={loading}
                                aria-label="Save name"
                            >
                                <Check class="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                class="h-7 w-7"
                                onclick={(e) => { e.stopPropagation(); cancelFolderRename(); }}
                                disabled={loading}
                                aria-label="Cancel rename"
                            >
                                <X class="h-4 w-4" />
                            </Button>
                        </div>
                    {:else}
                        <Folder class="h-[17px] w-[17px] flex-shrink-0 text-amber-500" />
                        <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                            {folder.folderName}
                        </span>
                        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                        <div
                            class="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100"
                            onclick={(e) => e.stopPropagation()}
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                class="h-7 w-7"
                                onclick={() => startFolderRename(folder)}
                                disabled={loading || editingFolderId !== null}
                                aria-label="Rename folder"
                            >
                                <Pencil class="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                class="h-7 w-7 text-destructive hover:text-destructive"
                                onclick={() => handleDeleteFolder(folder)}
                                disabled={loading}
                                aria-label="Delete folder"
                            >
                                <Trash2 class="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    {/if}
                </div>
            {/each}

            <!-- Files grouped by con-day -->
            {#each fileGroups as group (group.key)}
                <Section
                    variant="plain"
                    label={group.label}
                    count={group.files.length}
                    collapsed={!!dayCollapsed[group.key]}
                    ontoggle={(c) => {
                        dayCollapsed[group.key] = c;
                        dayCollapsed = dayCollapsed;
                    }}
                >
                    {#each group.files as file (file.fileId)}
                        {#if editingFileId === file.fileId}
                            <div class="flex items-center gap-2 px-3 py-2">
                                <input
                                    type="text"
                                    class="border rounded px-2 py-1 text-sm flex-1 min-w-0"
                                    bind:value={editFileName}
                                    onkeydown={(e) => handleRenameKeydown(e, file.fileId)}
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="h-7 w-7 text-green-600 hover:text-green-700"
                                    onclick={() => saveRename(file.fileId)}
                                    disabled={loading}
                                    aria-label="Save name"
                                >
                                    <Check class="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="h-7 w-7"
                                    onclick={cancelRename}
                                    disabled={loading}
                                    aria-label="Cancel rename"
                                >
                                    <X class="h-4 w-4" />
                                </Button>
                            </div>
                        {:else}
                            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                            <div
                                data-file-row
                                data-hint={'Open ' + file.fileName + ' on the map' + (file.conDay ? ' · ' + file.conDay : ' · no con day assigned')}
                                class="group/row flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-foreground/5"
                                onclick={() => handleLoadFile(file)}
                            >
                                <MapIcon class="h-[17px] w-[17px] flex-shrink-0 text-primary" />
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-1.5 text-sm font-semibold">
                                        <span class="truncate min-w-0">{file.fileName}</span>
                                        {#if file.shareRequested}
                                            <!-- Verb ②: at-a-glance "submitted to DEF CON run" state.
                                                 Data-only flag (no link); pending admin review. -->
                                            <span
                                                class="inline-flex flex-shrink-0 text-emerald-600"
                                                data-hint="Submitted to DEF CON run — pending review."
                                                aria-label="Submitted to DEF CON run — pending review."
                                            >
                                                <Send class="h-3.5 w-3.5" />
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                                        <span>v{file.version || 1}</span>
                                        {#if file.trackCount}
                                            <span>· {file.trackCount} track{file.trackCount !== 1 ? 's' : ''}</span>
                                        {/if}
                                        <span class="hidden sm:inline">· {formatFileSize(file.fileSize)}</span>
                                        <span class="hidden sm:inline">· {formatDate(file.updatedAt)}</span>
                                    </div>
                                </div>
                                <!-- Row actions. This wrapper MUST swallow the click: the whole row
                                     loads the file, so without it opening the menu would too. -->
                                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                                <div
                                    class="flex flex-shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100"
                                    onclick={(e) => e.stopPropagation()}
                                >
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        class="h-7 px-2.5 text-xs"
                                        onclick={() => startRename(file)}
                                        disabled={loading || editingFileId !== null}
                                    >Edit</Button>
                                    <DropdownMenu.Root>
                                        <DropdownMenu.Trigger
                                            class="inline-flex items-center justify-center h-7 w-7 rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                            disabled={loading}
                                            aria-label={'Actions for ' + file.fileName}
                                        >
                                            <Ellipsis class="h-3.5 w-3.5" />
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Content class="w-56" align="end">
                                            <DropdownMenu.Item
                                                onclick={() => { fileToShare = file; shareDialogOpen = true; }}
                                            >
                                                <Share2 class="h-4 w-4" />
                                                {#if filesWithShares.has(file.fileId)}
                                                    <span>Manage sharing</span>
                                                {:else}
                                                    <span>Share</span>
                                                {/if}
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item onclick={() => (conDayDialogFile = file)}>
                                                <CalendarCheck class="h-4 w-4" />
                                                <span>Assign day</span>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item
                                                onclick={() => {
                                                    routeConvertMsg = null;
                                                    routeConvertErr = null;
                                                    routeDialogFile = file;
                                                }}
                                            >
                                                <RouteIcon class="h-4 w-4" />
                                                <span>Save as Route</span>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item onclick={() => handleExportFile(file)}>
                                                <Download class="h-4 w-4" />
                                                <span>Export GPX</span>
                                            </DropdownMenu.Item>
                                            {#if (file.versionCount || 1) > 1}
                                                <DropdownMenu.Sub
                                                    onOpenChange={(isOpen) => { if (isOpen) fetchVersionHistory(file); }}
                                                >
                                                    <DropdownMenu.SubTrigger>
                                                        <History class="h-4 w-4" />
                                                        <span>Version history</span>
                                                    </DropdownMenu.SubTrigger>
                                                    <DropdownMenu.SubContent class="w-56">
                                                        <DropdownMenu.Label>
                                                            Version History ({file.versionCount} versions)
                                                        </DropdownMenu.Label>
                                                        <DropdownMenu.Separator />
                                                        {#if loadingVersions && loadingVersionsFileId === file.fileId}
                                                            <div class="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                                                                <Loader2 class="h-4 w-4 animate-spin" />
                                                                Loading...
                                                            </div>
                                                        {:else if fileVersions.length === 0}
                                                            <div class="px-2 py-3 text-sm text-muted-foreground">
                                                                No versions found
                                                            </div>
                                                        {:else}
                                                            <div class="max-h-64 overflow-y-auto">
                                                                {#each [...fileVersions].reverse() as ver}
                                                                    <DropdownMenu.Item
                                                                        class="flex justify-between items-center cursor-pointer {!ver.exists ? 'opacity-50' : ''}"
                                                                        disabled={!ver.exists}
                                                                        onclick={() => handleLoadVersion(file, ver.version)}
                                                                    >
                                                                        <span class="flex items-center gap-2">
                                                                            <span class="font-medium">v{ver.version}</span>
                                                                            {#if ver.version === versionHistoryCurrent}
                                                                                <span class="text-xs bg-primary text-primary-foreground px-1 rounded">current</span>
                                                                            {/if}
                                                                        </span>
                                                                        <span class="text-xs text-muted-foreground">
                                                                            {ver.createdAt ? formatVersionDate(ver.createdAt) : ''}
                                                                        </span>
                                                                    </DropdownMenu.Item>
                                                                {/each}
                                                            </div>
                                                        {/if}
                                                    </DropdownMenu.SubContent>
                                                </DropdownMenu.Sub>
                                            {/if}
                                            <DropdownMenu.Separator />
                                            <DropdownMenu.Item
                                                variant="destructive"
                                                onclick={() => handleDeleteFile(file)}
                                            >
                                                <Trash2 class="h-4 w-4" />
                                                <span>Delete</span>
                                            </DropdownMenu.Item>
                                        </DropdownMenu.Content>
                                    </DropdownMenu.Root>
                                </div>
                            </div>
                        {/if}
                    {/each}
                </Section>
            {/each}

            {#if isEmpty}
                <div class="p-8 text-center text-muted-foreground">
                    <p>No maps here yet.</p>
                    <p class="text-sm mt-1">Use <span class="font-medium">Add run</span> to log your first run.</p>
                </div>
            {/if}
        </Section>

        <!-- Global (shared) folders — read-only, globe marker -->
        {#if $globalFolders.length > 0}
            <Section
                label="Shared with you"
                count={$globalFolders.length}
                collapsed={sharedCollapsed}
                ontoggle={(c) => (sharedCollapsed = c)}
            >
                {#each $globalFolders as folder}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <div
                        data-file-row
                        data-hint={'Shared folder — open ' + folder.folderName}
                        class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-foreground/5"
                        onclick={() => handleNavigateToFolder(folder.folderId, folder.folderName)}
                    >
                        <Globe class="h-[17px] w-[17px] flex-shrink-0 text-blue-500" />
                        <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                            {folder.folderName}
                        </span>
                        <span
                            class="flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                        >
                            shared
                        </span>
                        <ChevronRight class="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    </div>
                {/each}
            </Section>
        {/if}
    {/if}

    {#snippet footer()}
        <span class="text-[11px] text-muted-foreground">GPX up to 10mb</span>
        <Button onclick={openAddRun}>
            <span class="mr-2 text-[13px] leading-none" aria-hidden="true">👟</span>Add run
        </Button>
    {/snippet}
</DialogShell>

<ShareDialog bind:open={shareDialogOpen} file={fileToShare} onSubmitChange={refreshFiles} />

{#if conDayDialogFile}
    <ConDaySaveDialog
        file={conDayDialogFile}
        open={true}
        onClose={() => (conDayDialogFile = null)}
        onSaved={() => {
            conDayDialogFile = null;
            void refreshFiles();
        }}
    />
{/if}

<!-- "Save as route" card dialog (routes-vs-runs spec) -->
<Dialog.Root
    open={routeDialogFile !== null}
    onOpenChange={(o) => {
        if (!o) routeDialogFile = null;
    }}
>
    <Dialog.Content class="sm:max-w-md">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <RouteIcon class="h-4 w-4" /> Save as route
            </Dialog.Title>
            <Dialog.Description>
                Make a shareable, dateless route template from
                "{routeDialogFile?.fileName}". The original file stays exactly as
                it is.
            </Dialog.Description>
        </Dialog.Header>
        {#if routeConvertMsg}
            <p class="text-sm font-medium text-green-600 dark:text-green-400">
                {routeConvertMsg}
            </p>
            <Button onclick={() => (routeDialogFile = null)}>Done</Button>
        {:else}
            <RouteCardForm
                initial={{ name: routeDialogFile?.fileName?.replace(/\.gpx$/i, '') ?? '' }}
                submitLabel={routeConvertBusy ? 'Creating…' : 'Create route'}
                busy={routeConvertBusy}
                onsubmit={onSaveAsRoute}
                oncancel={() => (routeDialogFile = null)}
            />
            {#if routeConvertErr}
                <p class="text-sm text-destructive">{routeConvertErr}</p>
            {/if}
        {/if}
    </Dialog.Content>
</Dialog.Root>
