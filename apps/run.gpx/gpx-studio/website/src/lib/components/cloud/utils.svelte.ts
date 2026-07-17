/**
 * "My Maps" (cloud storage) dialog state.
 *
 * Phase 62: the dialog no longer shape-shifts between SAVE / OPEN / BROWSE (the
 * old `CloudStorageMode` enum). "My Maps" is ONE view — your DEF CON run folder —
 * so its visibility is a single boolean. Opening a map is just clicking it;
 * saving is automatic (auto-save), so the Save-As / Save-All entry points and
 * their mode plumbing are gone.
 */
import { writable } from 'svelte/store';

/** Whether the unified "My Maps" dialog is open. */
export const cloudStorageOpen = writable(false);

/** Open the unified "My Maps" dialog. */
export function openMyMaps(): void {
    cloudStorageOpen.set(true);
}

/**
 * Backwards-compatible alias: ShareAcceptDialog (and any external caller) that
 * imported the old `openCloudStorage()` still lands on "My Maps".
 */
export const openCloudStorage = openMyMaps;

export function closeCloudStorage(): void {
    cloudStorageOpen.set(false);
}

// Share accept dialog state (unchanged).
export const shareAcceptDialogOpen = writable(false);
export const shareAcceptToken = writable<string | null>(null);

export function openShareAcceptDialog(token: string): void {
    shareAcceptToken.set(token);
    shareAcceptDialogOpen.set(true);
}

export function closeShareAcceptDialog(): void {
    shareAcceptDialogOpen.set(false);
    shareAcceptToken.set(null);
}
