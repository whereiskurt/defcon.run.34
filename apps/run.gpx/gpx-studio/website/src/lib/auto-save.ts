/**
 * Auto-Save Service for GPX Studio
 *
 * Provides automatic cloud saving for files that have been opened from
 * or saved to cloud storage. Uses content hashing to detect changes
 * and only saves when content has actually changed.
 */

import { writable, get, derived } from 'svelte/store';
import { buildGPX } from 'gpx';
import { saveOrUpdateToCloud, listCloudFiles, updateCloudFileContent, updateCloudFile, saveToCloud } from '$lib/cloud-sync';
import { fileStateCollection } from '$lib/logic/file-state';
import { isAuthenticated, hasGpxStudioAccess } from '$lib/stores/auth';
import { settings } from '$lib/logic/settings';
import { browser, dev } from '$app/environment';

// Auto-save interval: 1 minute for testing, 10 minutes for production
// TODO: Change back to `dev ? 1 * 60 * 1000 : 10 * 60 * 1000` after testing
const AUTO_SAVE_INTERVAL = 1 * 60 * 1000;

/**
 * Auto-save status for UI display
 */
export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

/**
 * Information about a cloud-linked file
 */
interface CloudLinkedFile {
  cloudFileId: string;
  fileName: string;
  folderId: string | null;
  lastHash: string;
  lastSaveTime: number;
  needsSync: boolean;
  wasDefaultName: boolean;  // True if file was created with auto-generated name like "New File 1"
}

/**
 * Simple string hash function (djb2)
 * Fast enough for change detection, not for cryptographic purposes
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * AutoSaveManager - Manages automatic cloud saving for GPX files
 */
class AutoSaveManager {
  private _enabled = writable<boolean>(true);
  private _status = writable<AutoSaveStatus>('idle');
  private _isOnline = writable<boolean>(browser ? navigator.onLine : true);
  private _cloudLinkedFiles = new Map<string, CloudLinkedFile>();
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _statusTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (browser) {
      // Monitor online/offline status
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());

      // Register beforeunload handler for tab close
      window.addEventListener('beforeunload', (e) => this.handleBeforeUnload(e));
    }
  }

  // Public stores
  get enabled() {
    return { subscribe: this._enabled.subscribe };
  }

  get status() {
    return { subscribe: this._status.subscribe };
  }

  get isOnline() {
    return { subscribe: this._isOnline.subscribe };
  }

  /**
   * Derived store: true if any files need sync
   */
  get hasPendingChanges() {
    return derived(this._status, () => {
      for (const file of this._cloudLinkedFiles.values()) {
        if (file.needsSync) return true;
      }
      return false;
    });
  }

  /**
   * Set auto-save enabled state
   */
  setEnabled(enabled: boolean) {
    console.log(`[AutoSave] setEnabled(${enabled})`);
    this._enabled.set(enabled);
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  /**
   * Start the auto-save timer
   */
  start() {
    if (this._intervalId) return; // Already running
    if (!get(this._enabled)) return; // Disabled

    console.log(`[AutoSave] Starting timer (interval: ${AUTO_SAVE_INTERVAL / 1000}s)`);
    this._intervalId = setInterval(() => {
      console.log('[AutoSave] Timer tick - checking for changes...');
      this.checkAndSave();
    }, AUTO_SAVE_INTERVAL);
  }

  /**
   * Stop the auto-save timer
   */
  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Register a file as cloud-linked (called when opening from or saving to cloud)
   * @param wasDefaultName - true if file was created with auto-generated name like "New File 1"
   */
  registerCloudLinkedFile(
    localFileId: string,
    cloudFileId: string,
    fileName: string,
    folderId: string | null,
    wasDefaultName: boolean = false
  ) {
    const file = fileStateCollection.getFile(localFileId);
    if (!file) return;

    const gpxContent = buildGPX(file, []);
    const hash = hashString(gpxContent);

    this._cloudLinkedFiles.set(localFileId, {
      cloudFileId,
      fileName,
      folderId,
      wasDefaultName,
      lastHash: hash,
      lastSaveTime: Date.now(),
      needsSync: false,
    });

    console.log(`[AutoSave] Registered file "${fileName}" (cloudId: ${cloudFileId}, hash: ${hash.slice(0,8)}, wasDefault: ${wasDefaultName})`);

    // Start timer if enabled and not running
    if (get(this._enabled) && !this._intervalId) {
      this.start();
    }
  }

  /**
   * Unregister a file (called when file is closed)
   */
  unregisterFile(localFileId: string) {
    this._cloudLinkedFiles.delete(localFileId);

    // Stop timer if no more cloud-linked files
    if (this._cloudLinkedFiles.size === 0) {
      this.stop();
    }
  }

  /**
   * Check if a file is cloud-linked
   */
  isCloudLinked(localFileId: string): boolean {
    return this._cloudLinkedFiles.has(localFileId);
  }

  /**
   * Get cloud file info for a local file
   */
  getCloudInfo(localFileId: string): CloudLinkedFile | undefined {
    return this._cloudLinkedFiles.get(localFileId);
  }

  /**
   * Handle file rename - either rename cloud file or create new one
   * @param localFileId - The local file ID
   * @param newName - The new name (without .gpx extension)
   * @returns Promise that resolves when rename is handled
   */
  async handleFileRenamed(localFileId: string, newName: string): Promise<void> {
    console.log(`[AutoSave] handleFileRenamed called: localFileId=${localFileId}, newName="${newName}"`);

    const info = this._cloudLinkedFiles.get(localFileId);
    if (!info) {
      console.log(`[AutoSave] File ${localFileId} is not cloud-linked, skipping rename`);
      return; // Not cloud-linked, nothing to do
    }

    const file = fileStateCollection.getFile(localFileId);
    if (!file) {
      console.log(`[AutoSave] File ${localFileId} not found in collection`);
      return;
    }

    // Skip if not authenticated
    if (!get(isAuthenticated) || !get(hasGpxStudioAccess)) {
      console.log('[AutoSave] Not authenticated, skipping rename');
      return;
    }

    const newFileName = `${newName}.gpx`;

    // If same name, nothing to do
    if (newFileName === info.fileName) {
      console.log(`[AutoSave] Name unchanged (${newFileName}), skipping`);
      return;
    }

    console.log(`[AutoSave] Renaming from "${info.fileName}" to "${newFileName}", wasDefaultName=${info.wasDefaultName}`);

    try {
      if (info.wasDefaultName) {
        // Rename the existing cloud file
        await updateCloudFile(info.cloudFileId, { fileName: newFileName });

        // Update tracking info
        this._cloudLinkedFiles.set(localFileId, {
          ...info,
          fileName: newFileName,
          wasDefaultName: false, // No longer a default name
        });
      } else {
        // Create a NEW cloud file with the new name
        const gpxContent = buildGPX(file, []);
        const lastFolder = get(settings.lastSaveFolder);
        const folderId = lastFolder === 'ROOT' ? null : lastFolder;

        const newCloudFileId = await saveToCloud(gpxContent, newFileName, {
          trackCount: file.trk?.length || 0,
          waypointCount: file.wpt?.length || 0,
        }, folderId);

        // Re-register with new cloud file
        const newHash = hashString(gpxContent);
        this._cloudLinkedFiles.set(localFileId, {
          cloudFileId: newCloudFileId,
          fileName: newFileName,
          folderId,
          lastHash: newHash,
          lastSaveTime: Date.now(),
          needsSync: false,
          wasDefaultName: false,
        });
      }
    } catch (error) {
      console.error('Failed to handle file rename:', error);
    }
  }

  /**
   * Check all cloud-linked files for changes and save if needed
   */
  async checkAndSave(): Promise<void> {
    // Skip if not authenticated or no access
    if (!get(isAuthenticated) || !get(hasGpxStudioAccess)) {
      console.log('[AutoSave] Skipping - not authenticated or no access');
      return;
    }

    // Skip if offline - mark as needs sync
    if (!get(this._isOnline)) {
      console.log('[AutoSave] Skipping - offline');
      this.markAllNeedsSync();
      return;
    }

    console.log(`[AutoSave] Checking ${this._cloudLinkedFiles.size} cloud-linked files`);
    const filesToSave: Array<{ localId: string; info: CloudLinkedFile; content: string }> = [];

    // Check each cloud-linked file for changes
    for (const [localFileId, info] of this._cloudLinkedFiles) {
      const file = fileStateCollection.getFile(localFileId);
      if (!file) {
        // File no longer exists locally, unregister
        console.log(`[AutoSave] File ${localFileId} no longer exists, unregistering`);
        this._cloudLinkedFiles.delete(localFileId);
        continue;
      }

      const gpxContent = buildGPX(file, []);
      const currentHash = hashString(gpxContent);

      console.log(`[AutoSave] File "${info.fileName}": lastHash=${info.lastHash.slice(0,8)}, currentHash=${currentHash.slice(0,8)}, needsSync=${info.needsSync}`);

      // Only save if content has changed
      if (currentHash !== info.lastHash || info.needsSync) {
        console.log(`[AutoSave] File "${info.fileName}" has changes, queuing for save`);
        filesToSave.push({ localId: localFileId, info, content: gpxContent });
      }
    }

    if (filesToSave.length === 0) {
      console.log('[AutoSave] No changes detected');
      return; // Nothing to save
    }

    // Save files
    this._status.set('saving');

    try {
      for (const { localId, info, content } of filesToSave) {
        const file = fileStateCollection.getFile(localId);
        if (!file) continue;

        // Update existing cloud file content
        await updateCloudFileContent(info.cloudFileId, content, {
          fileName: info.fileName,
          trackCount: file.trk?.length || 0,
          waypointCount: file.wpt?.length || 0,
        });

        // Update tracking info
        const newHash = hashString(content);
        this._cloudLinkedFiles.set(localId, {
          ...info,
          lastHash: newHash,
          lastSaveTime: Date.now(),
          needsSync: false,
        });
      }

      // Show "saved" briefly, then return to idle
      this._status.set('saved');
      this.scheduleStatusReset();
    } catch (error) {
      console.error('Auto-save failed:', error);
      this._status.set('error');
      this.scheduleStatusReset(5000);
    }
  }

  /**
   * Force an immediate save check (useful after coming back online)
   */
  async syncNow(): Promise<void> {
    await this.checkAndSave();
  }

  private markAllNeedsSync() {
    for (const [localId, info] of this._cloudLinkedFiles) {
      const file = fileStateCollection.getFile(localId);
      if (!file) continue;

      const gpxContent = buildGPX(file, []);
      const currentHash = hashString(gpxContent);

      if (currentHash !== info.lastHash) {
        this._cloudLinkedFiles.set(localId, {
          ...info,
          needsSync: true,
        });
      }
    }
  }

  private handleOnline() {
    this._isOnline.set(true);
    this._status.set('idle');

    // Sync immediately when coming back online
    this.syncNow();
  }

  private handleOffline() {
    this._isOnline.set(false);
    this._status.set('offline');
  }

  private handleBeforeUnload(e: BeforeUnloadEvent) {
    // Check if any files have pending changes
    let hasPending = false;

    for (const [localFileId, info] of this._cloudLinkedFiles) {
      const file = fileStateCollection.getFile(localFileId);
      if (!file) continue;

      const gpxContent = buildGPX(file, []);
      const currentHash = hashString(gpxContent);

      if (currentHash !== info.lastHash) {
        hasPending = true;
        break;
      }
    }

    if (hasPending && get(this._isOnline)) {
      // Try to save using sendBeacon if available
      // Note: Full GPX saves via sendBeacon are not reliable due to size limits
      // This primarily serves as a warning to the user
      e.preventDefault();
      e.returnValue = 'You have unsaved changes. Leave anyway?';
      return e.returnValue;
    }
  }

  private scheduleStatusReset(delay = 3000) {
    if (this._statusTimeout) {
      clearTimeout(this._statusTimeout);
    }
    this._statusTimeout = setTimeout(() => {
      const online = get(this._isOnline);
      this._status.set(online ? 'idle' : 'offline');
    }, delay);
  }
}

// Singleton instance
export const autoSaveManager = new AutoSaveManager();
