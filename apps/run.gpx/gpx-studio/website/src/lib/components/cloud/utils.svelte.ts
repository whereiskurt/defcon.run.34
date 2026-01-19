/**
 * Cloud storage state management
 */
import { writable, derived, get } from 'svelte/store';
import { toast } from 'svelte-sonner';
import { buildGPX } from 'gpx';
import {
    saveOrUpdateToCloud,
    listCloudFiles,
} from '$lib/cloud-sync';
import { auth, isAuthenticated, hasGpxStudioAccess } from '$lib/stores/auth';
import { fileStateCollection } from '$lib/logic/file-state';
import { settings } from '$lib/logic/settings';
import { selection } from '$lib/logic/selection';
import { autoSaveManager } from '$lib/auto-save';

/**
 * Cloud Storage dialog modes
 */
export enum CloudStorageMode {
    CLOSED = 'closed',
    SAVE = 'save',      // From "Save As..." menu - layers expanded, files collapsed
    OPEN = 'open',      // From "Open Remote..." menu - layers collapsed, files expanded
    BROWSE = 'browse',  // From "View > Cloud Storage" menu - both expanded
}

// Main mode store
export const cloudStorageMode = writable<CloudStorageMode>(CloudStorageMode.CLOSED);

// Derived store for backwards compatibility (dialog open check)
export const cloudStorageOpen = derived(
    cloudStorageMode,
    ($mode) => $mode !== CloudStorageMode.CLOSED
);

/**
 * Open Cloud Storage in Save mode (from "Save As..." menu)
 * Layers section expanded, Remote Files collapsed
 */
export function openCloudStorageSave() {
    cloudStorageMode.set(CloudStorageMode.SAVE);
}

/**
 * Open Cloud Storage in Open mode (from "Open Remote..." menu)
 * Layers section collapsed, Remote Files expanded
 */
export function openCloudStorageOpen() {
    cloudStorageMode.set(CloudStorageMode.OPEN);
}

/**
 * Open Cloud Storage in Browse mode (from "View > Cloud Storage" menu)
 * Both sections expanded
 */
export function openCloudStorageBrowse() {
    cloudStorageMode.set(CloudStorageMode.BROWSE);
}

/**
 * @deprecated Use mode-specific open functions instead
 */
export function openCloudStorage() {
    cloudStorageMode.set(CloudStorageMode.BROWSE);
}

export function closeCloudStorage() {
    cloudStorageMode.set(CloudStorageMode.CLOSED);
}

// Share accept dialog state
export const shareAcceptDialogOpen = writable(false);
export const shareAcceptToken = writable<string | null>(null);

export function openShareAcceptDialog(token: string) {
    shareAcceptToken.set(token);
    shareAcceptDialogOpen.set(true);
}

export function closeShareAcceptDialog() {
    shareAcceptDialogOpen.set(false);
    shareAcceptToken.set(null);
}

/**
 * Quick save to cloud without opening the dialog.
 * Saves selected layers (or all layers if none selected) to the last used folder.
 * Shows toast notifications for success/error.
 */
export async function quickSaveToCloud(): Promise<void> {
    // Check authentication
    await auth.checkSession();

    if (!get(isAuthenticated)) {
        toast.error('Sign in required to save to cloud');
        return;
    }

    if (!get(hasGpxStudioAccess)) {
        toast.error('GPX Studio access required');
        return;
    }

    // Get layers to save: selected layers, or all layers if none selected
    const selectedIds = get(selection).getSelected().map(item => item.getFileId());
    const layersToSave: string[] = [];

    if (selectedIds.length > 0) {
        // Use selected layers
        layersToSave.push(...selectedIds);
    } else {
        // Use all layers
        fileStateCollection.forEach((fileId) => {
            layersToSave.push(fileId);
        });
    }

    if (layersToSave.length === 0) {
        toast.error('No layers to save');
        return;
    }

    // Get target folder from settings
    const lastFolder = get(settings.lastSaveFolder);
    const targetFolderId = lastFolder === 'ROOT' ? null : lastFolder;

    try {
        // Load the file list for the target folder so saveOrUpdateToCloud can find existing files
        await listCloudFiles(targetFolderId);

        let savedCount = 0;
        let updatedCount = 0;

        for (const fileId of layersToSave) {
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

        // Show success message with details
        const total = savedCount + updatedCount;
        const folderName = targetFolderId ? 'folder' : 'root';
        let message = '';

        if (savedCount > 0 && updatedCount > 0) {
            message = `${savedCount} new file${savedCount > 1 ? 's' : ''} created, ${updatedCount} file${updatedCount > 1 ? 's' : ''} updated (new version)`;
        } else if (savedCount > 0) {
            message = `${savedCount} file${savedCount > 1 ? 's' : ''} saved to cloud`;
        } else if (updatedCount > 0) {
            message = `${updatedCount} file${updatedCount > 1 ? 's' : ''} updated to new version`;
        }

        toast.success(message, {
            description: 'Open View → Cloud Storage to see files and share them',
            duration: 4000,
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save';
        toast.error(`Cloud save failed: ${message}`);
    }
}
