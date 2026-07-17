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
        Footprints,
        Map as MapIcon,
    } from '@lucide/svelte';
    import ShareDialog from './ShareDialog.svelte';
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

    let loading = false;
    let error: string | null = null;
    let editingFileId: string | null = null;
    let editFileName: string = '';

    // Share dialog state
    let shareDialogOpen = false;
    let fileToShare: CloudFile | null = null;

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

<Dialog.Root open={$cloudStorageOpen} onOpenChange={(isOpen) => !isOpen && closeCloudStorage()}>
    <Dialog.Content class="!max-w-[820px] !w-[90vw] max-h-[85vh] overflow-hidden flex flex-col">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <Cloud class="h-5 w-5" />
                My Maps
            </Dialog.Title>
        </Dialog.Header>

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
            <!-- Toolbar: breadcrumbs + new folder + refresh -->
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1 text-sm overflow-x-auto min-w-0">
                    {#if $breadcrumbs.length > 1}
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
                    {:else}
                        <span class="text-muted-foreground">Your DEF CON run folder</span>
                    {/if}
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        onclick={showCreateFolder}
                        disabled={loading}
                        title="New folder"
                    >
                        <FolderPlus class="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        onclick={refreshFiles}
                        disabled={loading}
                        title="Refresh"
                    >
                        {#if loading}
                            <Loader2 class="h-4 w-4 animate-spin" />
                        {:else}
                            <RefreshCw class="h-4 w-4" />
                        {/if}
                    </Button>
                </div>
            </div>

            <div class="mt-2 space-y-2 overflow-y-auto flex-1 min-h-0">
                <!-- Error message -->
                {#if error}
                    <div class="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
                        {error}
                    </div>
                {/if}

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
                            title="Create"
                        >
                            <Check class="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            class="h-7 w-7"
                            onclick={cancelCreateFolder}
                            disabled={loading}
                            title="Cancel"
                        >
                            <X class="h-4 w-4" />
                        </Button>
                    </div>
                {/if}

                <!-- Global (shared) folders — read-only, globe marker -->
                {#each $globalFolders as folder}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <div
                        class="flex items-center gap-2 border rounded-md px-3 py-2 hover:bg-muted/30 cursor-pointer"
                        onclick={() => handleNavigateToFolder(folder.folderId, folder.folderName)}
                    >
                        <Globe class="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <span class="font-medium text-sm flex-1 truncate">{folder.folderName}</span>
                        <span class="text-xs text-muted-foreground">shared</span>
                        <ChevronRight class="h-4 w-4 text-muted-foreground" />
                    </div>
                {/each}

                <!-- User folders -->
                {#each $cloudFolders as folder}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <div
                        class="flex items-center gap-2 border rounded-md px-3 py-2 hover:bg-muted/30 cursor-pointer"
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
                                    title="Save"
                                >
                                    <Check class="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="h-7 w-7"
                                    onclick={(e) => { e.stopPropagation(); cancelFolderRename(); }}
                                    disabled={loading}
                                    title="Cancel"
                                >
                                    <X class="h-4 w-4" />
                                </Button>
                            </div>
                        {:else}
                            <Folder class="h-4 w-4 text-amber-500 flex-shrink-0" />
                            <span class="font-medium text-sm flex-1 truncate">{folder.folderName}</span>
                            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                            <div class="flex gap-0.5" onclick={(e) => e.stopPropagation()}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="h-7 w-7"
                                    onclick={() => startFolderRename(folder)}
                                    disabled={loading || editingFolderId !== null}
                                    title="Rename folder"
                                >
                                    <Pencil class="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="h-7 w-7 text-destructive hover:text-destructive"
                                    onclick={() => handleDeleteFolder(folder)}
                                    disabled={loading}
                                    title="Delete folder"
                                >
                                    <Trash2 class="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        {/if}
                    </div>
                {/each}

                <!-- Files grouped by con-day -->
                {#each fileGroups as group (group.key)}
                    <div class="pt-1">
                        <div class="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.label}
                        </div>
                        <div class="border rounded-md divide-y">
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
                                            title="Save"
                                        >
                                            <Check class="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            class="h-7 w-7"
                                            onclick={cancelRename}
                                            disabled={loading}
                                            title="Cancel"
                                        >
                                            <X class="h-4 w-4" />
                                        </Button>
                                    </div>
                                {:else}
                                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                                    <div
                                        class="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 cursor-pointer"
                                        onclick={() => handleLoadFile(file)}
                                        title="Open on the map"
                                    >
                                        <MapIcon class="h-4 w-4 text-primary flex-shrink-0" />
                                        <div class="min-w-0 flex-1">
                                            <div class="font-medium text-sm flex items-center gap-1.5" title={file.fileName}>
                                                <span class="truncate min-w-0">{file.fileName}</span>
                                                {#if file.shareRequested}
                                                    <!-- Verb ②: at-a-glance "submitted to DEF CON run" state.
                                                         Data-only flag (no link); pending admin review. -->
                                                    <span
                                                        class="inline-flex flex-shrink-0 text-emerald-600"
                                                        title="Submitted to DEF CON run — pending review"
                                                    >
                                                        <Send class="h-3.5 w-3.5" />
                                                    </span>
                                                {/if}
                                            </div>
                                            <div class="text-xs text-muted-foreground flex gap-2">
                                                <span>v{file.version || 1}</span>
                                                {#if file.trackCount}
                                                    <span>· {file.trackCount} track{file.trackCount !== 1 ? 's' : ''}</span>
                                                {/if}
                                                <span class="hidden sm:inline">· {formatFileSize(file.fileSize)}</span>
                                                <span class="hidden sm:inline">· {formatDate(file.updatedAt)}</span>
                                            </div>
                                        </div>
                                        <!-- Per-row actions (stopPropagation so they don't open the map) -->
                                        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                                        <div class="flex gap-0.5 flex-shrink-0" onclick={(e) => e.stopPropagation()}>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                class="h-7 w-7"
                                                onclick={() => startRename(file)}
                                                disabled={loading || editingFileId !== null}
                                                title="Rename"
                                            >
                                                <Pencil class="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                class="h-7 w-7 {filesWithShares.has(file.fileId) ? 'text-blue-600 hover:text-blue-700' : ''}"
                                                onclick={() => { fileToShare = file; shareDialogOpen = true; }}
                                                disabled={loading}
                                                title={filesWithShares.has(file.fileId) ? 'Shared — click to manage' : 'Share'}
                                            >
                                                <Share2 class="h-3.5 w-3.5" />
                                            </Button>
                                            {#if (file.versionCount || 1) > 1}
                                                <DropdownMenu.Root onOpenChange={(isOpen) => { if (isOpen) fetchVersionHistory(file); }}>
                                                    <DropdownMenu.Trigger
                                                        class="inline-flex items-center justify-center h-7 w-7 rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                                        disabled={loading}
                                                    >
                                                        <History class="h-3.5 w-3.5" />
                                                        <span class="sr-only">Version history</span>
                                                    </DropdownMenu.Trigger>
                                                    <DropdownMenu.Content class="w-56">
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
                                                    </DropdownMenu.Content>
                                                </DropdownMenu.Root>
                                            {/if}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                class="h-7 w-7 text-destructive hover:text-destructive"
                                                onclick={() => handleDeleteFile(file)}
                                                disabled={loading}
                                                title="Delete"
                                            >
                                                <Trash2 class="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                {/if}
                            {/each}
                        </div>
                    </div>
                {/each}

                {#if isEmpty}
                    <div class="p-8 text-center text-muted-foreground">
                        <p>No maps here yet.</p>
                        <p class="text-sm mt-1">Use <span class="font-medium">Add run</span> to log your first run.</p>
                    </div>
                {/if}
            </div>

            <!-- Footer actions -->
            <div class="flex justify-between gap-3 pt-3 flex-shrink-0 border-t mt-2">
                <Button onclick={openAddRun}>
                    <Footprints class="h-4 w-4 mr-2" />
                    Add run
                </Button>
                <Button variant="outline" onclick={() => exportAllFiles([])}>
                    <Download class="h-4 w-4 mr-2" />
                    Export
                </Button>
            </div>
        {/if}
    </Dialog.Content>
</Dialog.Root>

<ShareDialog bind:open={shareDialogOpen} file={fileToShare} onSubmitChange={refreshFiles} />
