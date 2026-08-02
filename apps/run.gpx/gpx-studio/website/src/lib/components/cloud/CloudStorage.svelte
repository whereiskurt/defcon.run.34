<script lang="ts">
    // "My Routes" — the unified cloud dialog. No more SAVE / OPEN / BROWSE modes
    // (the old CloudStorageMode). It is one view — your DEF CON run folder, your
    // runs grouped by con-day. Opening a route is just clicking it (auto-save
    // persists edits, so there is no Save button). Per-row share / rename /
    // delete / version-history survive; GLOBAL folders show read-only with a
    // globe marker.
    //
    // 2026-08-01 unified-routes spec: this list also ADOPTS orphan Route rows —
    // routes minted by the retired "Create a route" card form, which have no
    // backing GpxFile. They render as ordinary rows so there is one list and one
    // Share vocabulary, not two. "Save as Route" is gone: every row already is a
    // route, and Share → Public is what publishes it.
    import { onMount, onDestroy } from 'svelte';
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
        History,
        Download,
        Map as MapIcon,
        CalendarCheck,
        Upload,
    } from '@lucide/svelte';
    // Path import form, matching the `ui/` primitives.
    import Ellipsis from '@lucide/svelte/icons/ellipsis';
    import ShareDialog from './ShareDialog.svelte';
    import ConDaySaveDialog from './ConDaySaveDialog.svelte';
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
        listOrphanRoutes,
        deleteRoute,
        type CloudFile,
        type CloudFolder,
        type FileVersion,
        type RouteSummary,
    } from '$lib/cloud-sync';
    import { cloudStorageOpen, closeCloudStorage } from '$lib/components/cloud/utils.svelte';
    import { auth, isAuthenticated, hasGpxStudioAccess } from '$lib/stores/auth';
    import { settings } from '$lib/logic/settings';
    import {
        fileActions,
        uploadRouteFromFile,
        openCloudFileOnMap,
    } from '$lib/logic/file-actions';
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

    // Orphan routes: minted by the retired "Create a route" card form, so they
    // have no backing GpxFile. Adopted into this list so there is one list, not
    // two. They keep using the standalone /routes/{id}/publish|unpublish
    // endpoints — the unified /files/{id}/visibility route needs a file to
    // address, which these do not have.
    // (legacy-mode component — plain lets are reactive here, no runes)
    let orphanRoutes: RouteSummary[] = [];

    async function refreshOrphanRoutes() {
        try {
            orphanRoutes = await listOrphanRoutes();
        } catch {
            // The list simply stays empty; the files above are the main event.
            orphanRoutes = [];
        }
    }

    // Orphan routes have no backing file, so deleting the row IS deleting the
    // route — there is nothing left behind. Copies other runners already made
    // are independent GpxFiles and survive (the DELETE /routes/{id} contract).
    async function removeOrphanRoute(route: RouteSummary) {
        if (
            !confirm(
                `Delete "${route.name}"? This removes it for good. Copies other runners already saved are not affected.`
            )
        )
            return;
        loading = true;
        error = null;
        try {
            await deleteRoute(route.routeId);
            await refreshOrphanRoutes();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not delete the route';
        } finally {
            loading = false;
        }
    }

    async function toggleOrphanPublic(route: RouteSummary) {
        loading = true;
        error = null;
        try {
            const endpoint = route.visibility === 'published' ? 'unpublish' : 'publish';
            const response = await fetch(
                `${getApiBase()}/routes/${encodeURIComponent(route.routeId)}/${endpoint}`,
                { method: 'POST', credentials: 'include' }
            );
            if (!response.ok) throw new Error('Could not update sharing');
            await refreshOrphanRoutes();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not update sharing';
        } finally {
            loading = false;
        }
    }

    // "Upload route": a GPX that is a route, not a run — dateless, no con-day,
    // no quota. Before this the only upload path was "Log a run", which forces
    // a day tag, so there was no way to bring in a plain route.
    let routeUploadInput: HTMLInputElement | undefined;
    let uploadingRoute = false;

    async function onRouteUploadPicked(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const picked = input.files?.[0];
        input.value = '';
        if (!picked) return;
        uploadingRoute = true;
        error = null;
        try {
            await uploadRouteFromFile(picked);
            await refreshFiles();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Could not upload the route';
        } finally {
            uploadingRoute = false;
        }
    }

    // Share dialog state
    let shareDialogOpen = false;
    let fileToShare: CloudFile | null = null;

    // Con-day save dialog state (Task 10)
    let conDayDialogFile: CloudFile | null = null;

    // Version history state. Keyed BY fileId, deliberately: a single shared buffer
    // let one row render (and action) another row's versions whenever a fetch failed
    // or two hover-opened submenus overlapped. Reading `fileVersions[file.fileId]`
    // makes that cross-file render structurally impossible, not merely unlikely.
    let fileVersions: Record<string, FileVersion[]> = {};
    let versionHistoryCurrent: Record<string, number> = {};
    let loadingVersions = false;
    let loadingVersionsFileId: string | null = null;

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

    // Refresh every time the dialog OPENS, not just at mount.
    //
    // This component is mounted ONCE (by Menu.svelte) and merely hidden and
    // shown, so onMount alone made the list a snapshot from page load. Anything
    // that changed the server state afterwards — accepting a share link,
    // uploading a route, another tab — left the dialog showing stale contents,
    // and on a fresh load with nothing cached it simply looked empty.
    let wasCloudStorageOpen = false;
    const unsubscribeOpen = cloudStorageOpen.subscribe((isOpen) => {
        if (isOpen && !wasCloudStorageOpen && get(isAuthenticated) && get(hasGpxStudioAccess)) {
            void refreshFiles();
            void refreshConDayLabels();
        }
        wasCloudStorageOpen = isOpen;
    });

    onDestroy(unsubscribeOpen);

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
            // Orphan routes load alongside the files — one list, one refresh.
            void refreshOrphanRoutes();
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
            await openCloudFileOnMap(file.fileId, file.fileName, file.folderId ?? null);
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

        // Drop THIS file's cached list before the await, so a slow or failing fetch
        // shows "Loading..." then "No versions found" for this row rather than
        // whatever the previously-opened row left behind.
        fileVersions[file.fileId] = [];
        fileVersions = fileVersions;
        versionHistoryCurrent[file.fileId] = 0;
        versionHistoryCurrent = versionHistoryCurrent;

        loadingVersionsFileId = file.fileId;
        loadingVersions = true;
        error = null;
        try {
            const { versions, current } = await getFileVersions(file.fileId);
            fileVersions[file.fileId] = versions;
            fileVersions = fileVersions;
            versionHistoryCurrent[file.fileId] = current;
            versionHistoryCurrent = versionHistoryCurrent;
        } catch (e) {
            fileVersions[file.fileId] = [];
            fileVersions = fileVersions;
            error = e instanceof Error ? e.message : 'Failed to load version history';
        } finally {
            loadingVersions = false;
            loadingVersionsFileId = null;
        }
    }

    // The row badge is DERIVED from the file itself — `publishedRouteId` now
    // travels on the list payload. This replaced an N+1 probe that fired one
    // /shares request per row just to colour an icon. Link state is deliberately
    // not shown here; the Share dialog is where it is inspected.
    function shareBadge(file: CloudFile): string {
        return file.publishedRouteId ? 'Public' : 'Private';
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
    // Belt-and-braces guard: the footer is not rendered on the gate screens (see the
    // `footer={...}` prop below), but QuickStartHub only mounts when the same two
    // conditions hold — firing this without them would latch `quickStartOpen` at true
    // with no consumer mounted to reset it.
    function openAddRun() {
        if (!get(isAuthenticated) || !get(hasGpxStudioAccess)) return;
        closeCloudStorage();
        quickStartOpen.set(true);
    }
</script>

<!-- Hidden picker for "Upload route" (dateless — no con-day, no quota). -->
<input
    bind:this={routeUploadInput}
    type="file"
    accept=".gpx"
    class="hidden"
    onchange={onRouteUploadPicked}
/>

<!-- Footer actions. Declared out here and handed to DialogShell as a PROP rather than
     as an implicit child snippet: DialogShell draws the footer chrome with `{#if footer}`,
     and a snippet is always truthy, so guarding inside the snippet body would still leave
     an empty bordered strip on the gate screens. Passing `undefined` drops the whole row.
     The gate is the same pair of conditions QuickStartHub's `canShow` derives from, so
     "Add run" can never paint on a screen where it would be a dead end. -->
{#snippet addRunFooter()}
    <span class="text-[11px] text-muted-foreground">GPX up to 10mb</span>
    <Button
        variant="outline"
        onclick={() => routeUploadInput?.click()}
        disabled={uploadingRoute}
    >
        <Upload class="mr-2 h-4 w-4" />
        {uploadingRoute ? 'Uploading…' : 'Upload route'}
    </Button>
    <Button class="add-run-glow" onclick={openAddRun}>
        <span class="mr-2 text-[13px] leading-none" aria-hidden="true">👟</span>Add run
    </Button>
{/snippet}

<DialogShell
    open={$cloudStorageOpen}
    onOpenChange={(isOpen) => !isOpen && closeCloudStorage()}
    dialogId="mymaps"
    heading="My Routes"
    subheading={$breadcrumbs.length > 1 ? $breadcrumbs[$breadcrumbs.length - 1].name : 'Your DEF CON run folder'}
    footer={$isAuthenticated && $hasGpxStudioAccess ? addRunFooter : undefined}
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
                                        {#if file.publishedRouteId}
                                            <span
                                                class="inline-flex flex-shrink-0 text-emerald-600"
                                                data-hint="Public — on the community map."
                                                aria-label="Public — on the community map."
                                            >
                                                <Globe class="h-3.5 w-3.5" />
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                                        <span>{shareBadge(file)}</span>
                                        <span>· v{file.version || 1}</span>
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
                                                <span>Share</span>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item onclick={() => (conDayDialogFile = file)}>
                                                <CalendarCheck class="h-4 w-4" />
                                                <span>Assign day</span>
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
                                                        {:else if (fileVersions[file.fileId] ?? []).length === 0}
                                                            <div class="px-2 py-3 text-sm text-muted-foreground">
                                                                No versions found
                                                            </div>
                                                        {:else}
                                                            <div class="max-h-64 overflow-y-auto">
                                                                {#each [...(fileVersions[file.fileId] ?? [])].reverse() as ver}
                                                                    <DropdownMenu.Item
                                                                        class="flex justify-between items-center cursor-pointer {!ver.exists ? 'opacity-50' : ''}"
                                                                        disabled={!ver.exists}
                                                                        onclick={() => handleLoadVersion(file, ver.version)}
                                                                    >
                                                                        <span class="flex items-center gap-2">
                                                                            <span class="font-medium">v{ver.version}</span>
                                                                            {#if ver.version === versionHistoryCurrent[file.fileId]}
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

        <!-- Adopted orphan routes (2026-08-01 unified-routes spec): Route rows
             with no backing GpxFile, left over from the retired "Create a route"
             card form. Rendered as ordinary rows so the runner sees ONE list.
             They cannot be opened in the editor (there is no local file behind
             them) — the action available is the same Private/Public choice. -->
        {#if orphanRoutes.length > 0}
            <Section
                label="Routes"
                count={orphanRoutes.length}
                collapsed={false}
                ontoggle={() => {}}
            >
                {#each orphanRoutes as route (route.routeId)}
                    <div class="flex items-center gap-3 px-3 py-2 hover:bg-foreground/5">
                        <MapIcon class="h-[17px] w-[17px] flex-shrink-0 text-primary" />
                        <div class="min-w-0 flex-1">
                            <div class="truncate text-sm font-semibold">{route.name}</div>
                            <div class="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                                <span>
                                    {route.visibility === 'published' ? 'Public' : 'Private'}
                                </span>
                                {#if route.totalDistance}
                                    <span>· {(route.totalDistance / 1000).toFixed(1)} km</span>
                                {/if}
                            </div>
                        </div>
                        <div class="flex flex-shrink-0 items-center gap-1.5">
                            <Button
                                variant="outline"
                                size="sm"
                                class="h-7 px-2.5 text-xs"
                                disabled={loading || route.status !== 'active'}
                                onclick={() => toggleOrphanPublic(route)}
                            >
                                {route.visibility === 'published' ? 'Make private' : 'Make public'}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                class="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                aria-label={'Delete ' + route.name}
                                data-hint={'Delete ' + route.name}
                                disabled={loading}
                                onclick={() => removeOrphanRoute(route)}
                            >
                                <Trash2 class="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                {/each}
            </Section>
        {/if}

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
</DialogShell>

<ShareDialog bind:open={shareDialogOpen} file={fileToShare} onStateChange={refreshFiles} />

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
