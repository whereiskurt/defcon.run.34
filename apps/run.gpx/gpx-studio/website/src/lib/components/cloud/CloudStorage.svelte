<script lang="ts">
    import { onMount } from 'svelte';
    import { toast } from 'svelte-sonner';
    import * as Dialog from '$lib/components/ui/dialog/index.js';
    import * as Collapsible from '$lib/components/ui/collapsible/index.js';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
    import { Button } from '$lib/components/ui/button';
    import { Checkbox } from '$lib/components/ui/checkbox';
    import {
        Cloud,
        CloudUpload,
        FolderOpen,
        Trash2,
        RefreshCw,
        Loader2,
        AlertCircle,
        Pencil,
        Check,
        X,
        ChevronDown,
        Folder,
        FolderPlus,
        ChevronRight,
        Globe,
        Layers,
        Share2,
        History,
    } from '@lucide/svelte';
    import ShareDialog from './ShareDialog.svelte';
    import {
        cloudFiles,
        cloudFolders,
        globalFolders,
        currentFolderId,
        breadcrumbs,
        cloudSyncStatus,
        cloudSyncError,
        listCloudFiles,
        listCloudFolders,
        saveOrUpdateToCloud,
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
        type CloudFile,
        type CloudFolder,
        type FileVersion,
    } from '$lib/cloud-sync';
    import { cloudStorageOpen, cloudStorageMode, CloudStorageMode, closeCloudStorage } from '$lib/components/cloud/utils.svelte';
    import { auth, isAuthenticated, hasGpxStudioAccess } from '$lib/stores/auth';
    import { fileStateCollection } from '$lib/logic/file-state';
    import { settings } from '$lib/logic/settings';
    import { fileActions } from '$lib/logic/file-actions';
    import { selection } from '$lib/logic/selection';
    import { parseGPX, buildGPX } from 'gpx';
    import { get } from 'svelte/store';
    import { autoSaveManager } from '$lib/auto-save';

    let loading = false;
    let error: string | null = null;
    let editingFileId: string | null = null;
    let editFileName: string = '';
    let filesExpanded = false; // Collapsed by default

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

    // Layer selection state
    let layersExpanded = true;
    let selectedLayers: Set<string> = new Set();
    let knownLayers: Set<string> = new Set(); // Track layers we've seen to only auto-select new ones

    // Remote file selection state (for batch opening)
    let selectedRemoteFiles: Set<string> = new Set();

    function toggleRemoteFileSelection(fileId: string) {
        if (selectedRemoteFiles.has(fileId)) {
            selectedRemoteFiles.delete(fileId);
        } else {
            selectedRemoteFiles.add(fileId);
        }
        selectedRemoteFiles = selectedRemoteFiles; // trigger reactivity
    }

    function selectAllRemoteFiles() {
        selectedRemoteFiles = new Set($cloudFiles.map(f => f.fileId));
    }

    function selectNoneRemoteFiles() {
        selectedRemoteFiles = new Set();
    }

    // Mode-reactive section expansion
    $: {
        const mode = $cloudStorageMode;
        if (mode === CloudStorageMode.SAVE) {
            layersExpanded = true;
            filesExpanded = false;
        } else if (mode === CloudStorageMode.OPEN) {
            layersExpanded = false;
            filesExpanded = true;
        } else if (mode === CloudStorageMode.BROWSE) {
            layersExpanded = true;
            filesExpanded = true;
        }
        // Clear remote file selection when dialog opens
        if (mode !== CloudStorageMode.CLOSED) {
            selectedRemoteFiles = new Set();
        }
    }

    // Reactive: get all layers from fileStateCollection
    interface LayerInfo {
        fileId: string;
        name: string;
        trackCount: number;
        waypointCount: number;
    }

    let layers: LayerInfo[] = [];

    // Store reference for reactive subscription
    const fileOrderStore = settings.fileOrder;

    // Subscribe to file state collection changes
    // Use fileOrder store as reactive trigger (updates when files added/removed)
    $: {
        // Reference fileOrder to trigger reactivity when files change
        const _fileOrder = $fileOrderStore;
        const newLayers: LayerInfo[] = [];

        // Use the class's forEach method which handles getting file data
        fileStateCollection.forEach((fileId, file) => {
            newLayers.push({
                fileId,
                name: file.metadata?.name || `track-${fileId}`,
                trackCount: file.trk?.length || 0,
                waypointCount: file.wpt?.length || 0,
            });
        });
        layers = newLayers;

        // Auto-select only truly NEW layers (not seen before)
        layers.forEach(l => {
            if (!knownLayers.has(l.fileId)) {
                knownLayers.add(l.fileId);
                selectedLayers.add(l.fileId);
            }
        });
        // Remove deleted layers from selection and known set
        const layerIds = new Set(layers.map(l => l.fileId));
        selectedLayers.forEach(id => {
            if (!layerIds.has(id)) {
                selectedLayers.delete(id);
            }
        });
        knownLayers.forEach(id => {
            if (!layerIds.has(id)) {
                knownLayers.delete(id);
            }
        });
        selectedLayers = selectedLayers; // trigger reactivity
    }

    function toggleLayerSelection(fileId: string) {
        if (selectedLayers.has(fileId)) {
            selectedLayers.delete(fileId);
        } else {
            selectedLayers.add(fileId);
        }
        selectedLayers = selectedLayers; // trigger reactivity
    }

    function selectAllLayers() {
        selectedLayers = new Set(layers.map(l => l.fileId));
    }

    function selectNoneLayers() {
        selectedLayers = new Set();
    }

    onMount(async () => {
        // Check auth and load files on mount
        await auth.checkSession();
        if (get(isAuthenticated) && get(hasGpxStudioAccess)) {
            await refreshFiles();
        }
    });

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
            filesExpanded = true;
            // Clear remote file selection when navigating folders
            selectedRemoteFiles = new Set();
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
        filesExpanded = true;
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
            const id = fileActions.add(gpx);
            selection.selectFileWhenLoaded(gpx._data.id);

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
                const response = await fetch(`/api/gpx/shares?fileId=${file.fileId}`, {
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

        const timeStr = date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        }).replace(' ', '').toLowerCase();

        if (fileDate.getTime() === today.getTime()) {
            return `Today ${timeStr}`;
        } else if (fileDate.getTime() === yesterday.getTime()) {
            return `Yesterday ${timeStr}`;
        } else {
            // Within last week, show day name
            const daysAgo = Math.floor((today.getTime() - fileDate.getTime()) / (24 * 60 * 60 * 1000));
            if (daysAgo < 7) {
                const dayName = date.toLocaleDateString(undefined, { weekday: 'short' });
                return `${dayName} ${timeStr}`;
            }
            // Older dates
            return date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
            }) + ` ${timeStr}`;
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
            // Include version in the name to distinguish from current
            const baseName = file.fileName.replace(/\.gpx$/i, '');
            gpx.metadata.name = `${baseName} (v${version})`;
            const id = fileActions.add(gpx);
            selection.selectFileWhenLoaded(gpx._data.id);
            closeCloudStorage();
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load version';
        } finally {
            loading = false;
        }
    }

    // Open selected remote files (batch load)
    async function handleOpenSelectedFiles() {
        if (selectedRemoteFiles.size === 0) {
            error = 'No files selected';
            return;
        }

        loading = true;
        error = null;
        let loadedCount = 0;
        try {
            for (const fileId of selectedRemoteFiles) {
                const file = $cloudFiles.find(f => f.fileId === fileId);
                if (!file) continue;

                const { content } = await loadFromCloud(file.fileId);
                const gpx = parseGPX(content);
                if (gpx.metadata === undefined) {
                    gpx.metadata = {};
                }
                gpx.metadata.name = file.fileName.replace(/\.gpx$/i, '');
                fileActions.add(gpx);
                selection.selectFileWhenLoaded(gpx._data.id);

                // Register file with auto-save manager (file is now cloud-linked)
                autoSaveManager.registerCloudLinkedFile(
                    gpx._data.id,
                    file.fileId,
                    file.fileName,
                    file.folderId ?? null
                );

                loadedCount++;
            }
            closeCloudStorage();
            toast.success(`${loadedCount} file${loadedCount > 1 ? 's' : ''} loaded`);
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load files';
        } finally {
            loading = false;
        }
    }

    // Save selected layers (overwrites existing files by name)
    async function handleSaveSelectedLayers() {
        if (selectedLayers.size === 0) {
            error = 'No layers selected';
            return;
        }

        loading = true;
        error = null;
        try {
            const targetFolderId = get(currentFolderId);
            let savedCount = 0;
            let updatedCount = 0;

            for (const fileId of selectedLayers) {
                const file = fileStateCollection.getFile(fileId);
                if (!file) continue;

                const gpxContent = buildGPX(file, []);
                const fileName = `${file.metadata?.name || `track-${fileId}`}.gpx`;
                const result = await saveOrUpdateToCloud(gpxContent, fileName, {
                    trackCount: file.trk?.length || 0,
                    waypointCount: file.wpt?.length || 0,
                }, targetFolderId);

                // Register file with auto-save manager (file is now cloud-linked)
                autoSaveManager.registerCloudLinkedFile(
                    fileId,
                    result.fileId,
                    fileName,
                    targetFolderId
                );

                if (result.wasUpdate) {
                    updatedCount++;
                } else {
                    savedCount++;
                }
            }

            // Persist last save folder (use 'ROOT' for null/root folder)
            settings.lastSaveFolder.set(targetFolderId ?? 'ROOT');

            await refreshFiles();

            // Show success toast
            let message = '';
            if (savedCount > 0 && updatedCount > 0) {
                message = `${savedCount} new file${savedCount > 1 ? 's' : ''} created, ${updatedCount} updated to new version`;
            } else if (savedCount > 0) {
                message = `${savedCount} file${savedCount > 1 ? 's' : ''} saved to cloud`;
            } else if (updatedCount > 0) {
                message = `${updatedCount} file${updatedCount > 1 ? 's' : ''} updated to new version`;
            }
            toast.success(message, {
                description: 'Click the share icon next to a file to create a share link',
            });

            // Auto-expand Remote Files section so user can see their files
            filesExpanded = true;
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to save files';
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

        const timeStr = date.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        }).replace(' ', '').toLowerCase();

        if (fileDate.getTime() === today.getTime()) {
            return `Today @ ${timeStr}`;
        } else if (fileDate.getTime() === yesterday.getTime()) {
            return `Yesterday @ ${timeStr}`;
        } else {
            // Format as YYYYMMDD.HHMMSS
            const pad = (n: number) => n.toString().padStart(2, '0');
            return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
        }
    }
</script>

<Dialog.Root open={$cloudStorageOpen} onOpenChange={(isOpen) => !isOpen && closeCloudStorage()}>
    <Dialog.Content class="!max-w-[900px] !w-[90vw] max-h-[85vh] overflow-y-auto">
        <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2">
                <Cloud class="h-5 w-5" />
                {#if $cloudStorageMode === CloudStorageMode.SAVE}
                    Save to Cloud
                {:else if $cloudStorageMode === CloudStorageMode.OPEN}
                    Open from Cloud
                {:else}
                    Cloud Storage
                {/if}
            </Dialog.Title>
        </Dialog.Header>

        {#if !$isAuthenticated}
            <div class="flex flex-col items-center justify-center py-8 text-center">
                <AlertCircle class="h-12 w-12 text-muted-foreground mb-4" />
                <p class="text-muted-foreground mb-4">You need to sign in to access cloud storage.</p>
                <Button onclick={() => auth.login()}>Sign In</Button>
            </div>
        {:else if !$hasGpxStudioAccess}
            <div class="flex flex-col items-center justify-center py-8 text-center">
                <AlertCircle class="h-12 w-12 text-destructive mb-4" />
                <p class="text-destructive mb-4">Access denied. You need the gpxstudio service.</p>
                <p class="text-muted-foreground text-sm">Contact an admin to request access.</p>
            </div>
        {:else}
            <div class="space-y-4">
                <!-- Error message -->
                {#if error}
                    <div class="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
                        {error}
                    </div>
                {/if}

                <!-- Layer Selection (on top) - hidden in OPEN mode -->
                {#if $cloudStorageMode !== CloudStorageMode.OPEN}
                <Collapsible.Root bind:open={layersExpanded} class="border rounded-md">
                    <Collapsible.Trigger class="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors">
                        <div class="flex items-center gap-2">
                            <Layers class="h-4 w-4 text-muted-foreground" />
                            <span class="font-medium">Maps</span>
                            <span class="text-sm text-muted-foreground">({selectedLayers.size}/{layers.length} selected)</span>
                        </div>
                        <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform {layersExpanded ? 'rotate-180' : ''}" />
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                        <div class="border-t">
                            {#if layers.length === 0}
                                <div class="p-6 text-center text-muted-foreground">
                                    <p>No layers loaded.</p>
                                    <p class="text-sm mt-1">Open a GPX file to see it here.</p>
                                </div>
                            {:else}
                                <!-- Select All / None buttons -->
                                <div class="px-4 py-2 border-b bg-muted/30 flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onclick={() => selectAllLayers()}
                                        disabled={loading || selectedLayers.size === layers.length}
                                    >
                                        Select All
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onclick={() => selectNoneLayers()}
                                        disabled={loading || selectedLayers.size === 0}
                                    >
                                        Select None
                                    </Button>
                                </div>
                                <!-- Layer checkboxes -->
                                <div class="max-h-48 overflow-auto">
                                    {#each layers as layer}
                                        <label
                                            class="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 cursor-pointer border-b last:border-b-0"
                                        >
                                            <Checkbox
                                                checked={selectedLayers.has(layer.fileId)}
                                                onCheckedChange={() => toggleLayerSelection(layer.fileId)}
                                                disabled={loading}
                                            />
                                            <div class="flex-1 min-w-0">
                                                <div class="font-medium text-sm truncate">{layer.name}</div>
                                                <div class="text-xs text-muted-foreground">
                                                    {layer.trackCount} track{layer.trackCount !== 1 ? 's' : ''}
                                                    {#if layer.waypointCount > 0}
                                                        , {layer.waypointCount} waypoint{layer.waypointCount !== 1 ? 's' : ''}
                                                    {/if}
                                                </div>
                                            </div>
                                        </label>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </Collapsible.Content>
                </Collapsible.Root>
                {/if}

                <!-- Remote Files - Collapsible -->
                <Collapsible.Root bind:open={filesExpanded} class="border rounded-md">
                    <Collapsible.Trigger class="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors">
                        <div class="flex items-center gap-2">
                            <Cloud class="h-4 w-4 text-muted-foreground" />
                            <span class="font-medium">Remote Files</span>
                            <span class="text-sm text-muted-foreground">({$cloudFolders.length + $cloudFiles.length})</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                class="h-7 w-7"
                                onclick={(e) => { e.stopPropagation(); showCreateFolder(); }}
                                disabled={loading}
                                title="New folder"
                            >
                                <FolderPlus class="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                class="h-7 w-7"
                                onclick={(e) => { e.stopPropagation(); refreshFiles(); }}
                                disabled={loading}
                                title="Refresh"
                            >
                                {#if loading}
                                    <Loader2 class="h-4 w-4 animate-spin" />
                                {:else}
                                    <RefreshCw class="h-4 w-4" />
                                {/if}
                            </Button>
                            <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform {filesExpanded ? 'rotate-180' : ''}" />
                        </div>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                        <!-- Breadcrumb navigation -->
                        {#if $breadcrumbs.length > 1}
                            <div class="border-t px-4 py-2 flex items-center gap-1 text-sm bg-muted/30 overflow-x-auto">
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
                        <!-- Select All/None toolbar for remote files (in open/browse modes) -->
                        {#if $cloudStorageMode !== CloudStorageMode.SAVE && $cloudFiles.length > 0}
                            <div class="border-t px-4 py-2 bg-muted/30 flex gap-2 items-center">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onclick={selectAllRemoteFiles}
                                    disabled={loading || selectedRemoteFiles.size === $cloudFiles.length}
                                >
                                    Select All
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onclick={selectNoneRemoteFiles}
                                    disabled={loading || selectedRemoteFiles.size === 0}
                                >
                                    Select None
                                </Button>
                                {#if selectedRemoteFiles.size > 0}
                                    <span class="text-sm text-muted-foreground ml-2">
                                        {selectedRemoteFiles.size} selected
                                    </span>
                                {/if}
                            </div>
                        {/if}
                        <div class="border-t max-h-64 overflow-auto">
                            {#if $cloudFolders.length === 0 && $cloudFiles.length === 0 && !creatingFolder}
                                <div class="p-6 text-center text-muted-foreground">
                                    <p>No files in this folder yet.</p>
                                    <p class="text-sm mt-1">Save your layers or create a folder to get started.</p>
                                </div>
                            {:else}
                                <table class="w-full">
                                    <thead class="bg-muted/50 sticky top-0">
                                        <tr>
                                            {#if $cloudStorageMode !== CloudStorageMode.SAVE}
                                                <th class="w-10 px-2 py-2"></th>
                                            {/if}
                                            <th class="text-left px-4 py-2 font-medium text-sm">Name</th>
                                            <th class="text-left px-4 py-2 font-medium text-sm">Size</th>
                                            <th class="text-left px-4 py-2 font-medium text-sm hidden sm:table-cell">Updated</th>
                                            <th class="text-center px-4 py-2 font-medium text-sm">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <!-- Create folder input row -->
                                        {#if creatingFolder}
                                            <tr class="border-t bg-muted/20">
                                                <td class="px-4 py-2" colspan="4">
                                                    <div class="flex items-center gap-2">
                                                        <FolderPlus class="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                        <input
                                                            type="text"
                                                            class="border rounded px-2 py-1 text-sm flex-1 min-w-0"
                                                            placeholder="New folder name"
                                                            bind:value={newFolderName}
                                                            onkeydown={handleCreateFolderKeydown}
                                                            autofocus
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
                                                </td>
                                            </tr>
                                        {/if}

                                        <!-- Global folders (at root only) -->
                                        {#each $globalFolders as folder}
                                            <tr class="border-t hover:bg-muted/30 cursor-pointer" onclick={() => handleNavigateToFolder(folder.folderId, folder.folderName)}>
                                                {#if $cloudStorageMode !== CloudStorageMode.SAVE}
                                                    <td class="px-2 py-2"></td>
                                                {/if}
                                                <td class="px-4 py-2">
                                                    <div class="flex items-center gap-2">
                                                        <Globe class="h-4 w-4 text-blue-500 flex-shrink-0" />
                                                        <span class="font-medium text-sm">{folder.folderName}</span>
                                                        <span class="text-xs text-muted-foreground">shared</span>
                                                    </div>
                                                </td>
                                                <td class="px-4 py-2 text-sm text-muted-foreground">--</td>
                                                <td class="px-4 py-2 text-sm text-muted-foreground hidden sm:table-cell">
                                                    {formatDate(folder.createdAt)}
                                                </td>
                                                <td class="px-4 py-2 text-center">
                                                    <ChevronRight class="h-4 w-4 text-muted-foreground" />
                                                </td>
                                            </tr>
                                        {/each}

                                        <!-- User folders -->
                                        {#each $cloudFolders as folder}
                                            <tr class="border-t hover:bg-muted/30 cursor-pointer" onclick={() => handleNavigateToFolder(folder.folderId, folder.folderName)}>
                                                {#if $cloudStorageMode !== CloudStorageMode.SAVE}
                                                    <td class="px-2 py-2"></td>
                                                {/if}
                                                <td class="px-4 py-2">
                                                    {#if editingFolderId === folder.folderId}
                                                        <div class="flex items-center gap-2" onclick={(e) => e.stopPropagation()}>
                                                            <Folder class="h-4 w-4 text-amber-500 flex-shrink-0" />
                                                            <input
                                                                type="text"
                                                                class="border rounded px-2 py-1 text-sm flex-1 min-w-0"
                                                                bind:value={editFolderName}
                                                                onkeydown={(e) => handleFolderRenameKeydown(e, folder.folderId)}
                                                                autofocus
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
                                                        <div class="flex items-center gap-2">
                                                            <Folder class="h-4 w-4 text-amber-500 flex-shrink-0" />
                                                            <span class="font-medium text-sm">{folder.folderName}</span>
                                                        </div>
                                                    {/if}
                                                </td>
                                                <td class="px-4 py-2 text-sm text-muted-foreground">--</td>
                                                <td class="px-4 py-2 text-sm text-muted-foreground hidden sm:table-cell">
                                                    {formatDate(folder.createdAt)}
                                                </td>
                                                <td class="px-4 py-2 text-center">
                                                    <div class="flex gap-1 justify-center" onclick={(e) => e.stopPropagation()}>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            class="h-8 w-8"
                                                            onclick={() => startFolderRename(folder)}
                                                            disabled={loading || editingFolderId !== null}
                                                            title="Rename folder"
                                                        >
                                                            <Pencil class="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            class="h-8 w-8 text-destructive hover:text-destructive"
                                                            onclick={() => handleDeleteFolder(folder)}
                                                            disabled={loading}
                                                            title="Delete folder"
                                                        >
                                                            <Trash2 class="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        {/each}

                                        <!-- Files -->
                                        {#each $cloudFiles as file}
                                            <tr class="border-t hover:bg-muted/30">
                                                {#if $cloudStorageMode !== CloudStorageMode.SAVE}
                                                    <td class="px-2 py-2 text-center">
                                                        <Checkbox
                                                            checked={selectedRemoteFiles.has(file.fileId)}
                                                            onCheckedChange={() => toggleRemoteFileSelection(file.fileId)}
                                                            disabled={loading}
                                                        />
                                                    </td>
                                                {/if}
                                                <td class="px-4 py-2">
                                                    {#if editingFileId === file.fileId}
                                                        <div class="flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                class="border rounded px-2 py-1 text-sm flex-1 min-w-0"
                                                                bind:value={editFileName}
                                                                onkeydown={(e) => handleRenameKeydown(e, file.fileId)}
                                                                autofocus
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
                                                        <div class="flex items-center gap-1.5">
                                                            <span class="font-medium text-sm" title={file.fileName}>
                                                                {file.fileName.length > 28 ? file.fileName.slice(0, 28) + '...' : file.fileName}
                                                            </span>
                                                            <span class="text-xs text-muted-foreground">v{file.version || 1}</span>
                                                            {#if file.trackCount}
                                                                <span class="text-xs text-muted-foreground">
                                                                    · {file.trackCount} track{file.trackCount !== 1 ? 's' : ''}
                                                                </span>
                                                            {/if}
                                                        </div>
                                                    {/if}
                                                </td>
                                                <td class="px-4 py-2 text-sm text-muted-foreground">
                                                    {formatFileSize(file.fileSize)}
                                                </td>
                                                <td class="px-4 py-2 text-sm text-muted-foreground hidden sm:table-cell">
                                                    {formatDate(file.updatedAt)}
                                                </td>
                                                <td class="px-4 py-2 text-center">
                                                    <div class="flex gap-1 justify-center">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            class="h-8 w-8"
                                                            onclick={() => startRename(file)}
                                                            disabled={loading || editingFileId !== null}
                                                            title="Rename file"
                                                        >
                                                            <Pencil class="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            class="h-8 w-8 {filesWithShares.has(file.fileId) ? 'text-blue-600 hover:text-blue-700' : ''}"
                                                            onclick={() => { fileToShare = file; shareDialogOpen = true; }}
                                                            disabled={loading}
                                                            title={filesWithShares.has(file.fileId) ? 'Shared - click to manage' : 'Share'}
                                                        >
                                                            <Share2 class="h-4 w-4" />
                                                        </Button>
                                                        <!-- Version dropdown (only show if multiple versions exist) -->
                                                        {#if (file.versionCount || 1) > 1}
                                                            <DropdownMenu.Root onOpenChange={(open) => { if (open) fetchVersionHistory(file); }}>
                                                                <DropdownMenu.Trigger
                                                                    class="inline-flex items-center justify-center h-8 w-8 rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                                                    disabled={loading}
                                                                >
                                                                    <History class="h-4 w-4" />
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
                                                            class="h-8 w-8 text-destructive hover:text-destructive"
                                                            onclick={() => handleDeleteFile(file)}
                                                            disabled={loading}
                                                            title="Delete file"
                                                        >
                                                            <Trash2 class="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            {/if}
                        </div>
                    </Collapsible.Content>
                </Collapsible.Root>

                <!-- Mode-aware action buttons -->
                <div class="flex justify-center gap-3 pt-2">
                    <!-- Save button - shown in save and browse modes -->
                    {#if $cloudStorageMode === CloudStorageMode.SAVE || $cloudStorageMode === CloudStorageMode.BROWSE}
                        <Button
                            class="bg-green-600 hover:bg-green-700 text-white px-6 py-5"
                            onclick={handleSaveSelectedLayers}
                            disabled={loading || selectedLayers.size === 0}
                            title="Save selected layers, overwriting existing files with the same name"
                        >
                            {#if loading}
                                <Loader2 class="h-5 w-5 mr-2 animate-spin" />
                            {:else}
                                <CloudUpload class="h-5 w-5 mr-2" />
                            {/if}
                            Save
                        </Button>
                    {/if}

                    <!-- Open Selected button - shown in open and browse modes -->
                    {#if $cloudStorageMode === CloudStorageMode.OPEN || $cloudStorageMode === CloudStorageMode.BROWSE}
                        <Button
                            class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-5"
                            onclick={handleOpenSelectedFiles}
                            disabled={loading || selectedRemoteFiles.size === 0}
                            title="Open selected files from cloud"
                        >
                            {#if loading}
                                <Loader2 class="h-5 w-5 mr-2 animate-spin" />
                            {:else}
                                <FolderOpen class="h-5 w-5 mr-2" />
                            {/if}
                            Open Selected{selectedRemoteFiles.size > 0 ? ` (${selectedRemoteFiles.size})` : ''}
                        </Button>
                    {/if}
                </div>
            </div>
        {/if}

    </Dialog.Content>
</Dialog.Root>

<ShareDialog bind:open={shareDialogOpen} file={fileToShare} />
