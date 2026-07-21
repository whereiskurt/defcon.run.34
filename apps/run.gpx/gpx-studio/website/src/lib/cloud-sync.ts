/**
 * Cloud Sync Layer for GPX Studio
 * Syncs local storage with our S3-backed API for persistent cloud storage.
 *
 * Architecture:
 * - Local IndexedDB (Dexie) remains for session state and undo/redo
 * - CloudSync layer syncs to S3 via presigned URLs on explicit save/load
 * - User's files are isolated under their userId prefix in S3
 */

import { writable, get } from 'svelte/store';
import { base } from '$app/paths';
import { browser } from '$app/environment';

// Get API base path from SvelteKit's base (e.g., /use1/studio -> /use1)
export function getApiBase(): string {
  return base.replace('/studio', '') + '/api/gpx';
}

// Get auth API base path
function getAuthBase(): string {
  return base.replace('/studio', '') + '/api/auth';
}

/**
 * Custom error class for authentication errors.
 * Includes a flag to indicate the user should be redirected to login.
 */
export class AuthenticationError extends Error {
  public readonly shouldRedirect: boolean;

  constructor(message: string, shouldRedirect = true) {
    super(message);
    this.name = 'AuthenticationError';
    this.shouldRedirect = shouldRedirect;
  }
}

/**
 * Handle 401 responses by redirecting to login.
 * This is called when API requests fail due to expired/missing session.
 */
export function redirectToLogin(): void {
  if (browser) {
    // Redirect to signin, which will auto-redirect to OIDC provider
    const currentUrl = encodeURIComponent(window.location.href);
    window.location.href = `${getAuthBase()}/signin?callbackUrl=${currentUrl}`;
  }
}

/**
 * Handle API response errors, automatically redirecting on 401.
 * @param response - The fetch Response object
 * @param errorMessage - Default error message if not 401/403
 * @throws AuthenticationError for 401 responses
 * @throws Error for other error responses
 */
function handleApiError(response: Response, errorMessage: string): never {
  if (response.status === 401) {
    // Session expired or missing - redirect to login
    redirectToLogin();
    throw new AuthenticationError('Session expired. Redirecting to login...');
  }
  if (response.status === 403) {
    throw new Error('Access denied - gpxstudio service required');
  }
  throw new Error(errorMessage);
}

/**
 * Per-con-day usage for the signed-in runner (Phase 60). Mirrors the webapp
 * ConDayUsage shape returned by GET /api/gpx/conday-usage. `date` is the value
 * saved as a file's conDay; `selectable` is false for future con-days.
 */
export interface ConDayUsage {
  key: string;
  label: string;
  date: string;
  count: number;
  remaining: number;
  selectable: boolean;
}

/** Fetch per-con-day usage for the "Log a run" day picker. */
export async function getConDayUsage(): Promise<ConDayUsage[]> {
  const response = await fetch(`${getApiBase()}/conday-usage`, {
    credentials: 'include',
  });
  if (!response.ok) handleApiError(response, 'Failed to load con-day usage');
  return (await response.json()).usage as ConDayUsage[];
}

export interface CloudFile {
  fileId: string;
  fileName: string;
  fileSize: number;
  folderId?: string;
  tags?: string[];
  trackCount?: number;
  waypointCount?: number;
  totalDistance?: number;
  totalElevation?: number;
  uploadedBy?: string;
  version?: number;
  versionCount?: number;
  // Con-day tag (Phase 60): ISO date "YYYY-MM-DD", one of CON_DAYS. Used to group
  // "My runs" by con-day in the My Maps dialog.
  conDay?: string;
  // Submission flag (Phase 64, verb ②): true once the runner has submitted this
  // route to the DEF CON run admin review queue via POST /files/{id}/request-share.
  // Data only — it is NOT a shareable link. Returned by the files list GET.
  shareRequested?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FileVersion {
  version: number;
  exists: boolean;
  createdAt?: number;
}

export interface CloudFolder {
  folderId: string;
  folderName: string;
  parentFolderId?: string;
  depth: number;
  isGlobal: boolean;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Breadcrumb {
  id: string | null;
  name: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'error';

export const cloudSyncStatus = writable<SyncStatus>('idle');
export const cloudSyncError = writable<string | null>(null);
export const cloudFiles = writable<CloudFile[]>([]);
export const cloudFolders = writable<CloudFolder[]>([]);
export const globalFolders = writable<CloudFolder[]>([]);
export const currentFolderId = writable<string | null>(null);
export const breadcrumbs = writable<Breadcrumb[]>([{ id: null, name: 'Root' }]);

/**
 * List user's GPX files from the cloud
 * @param folderId - Optional folder ID to filter by. Omit for root level.
 * @param isGlobal - If true, list files from global folder context
 */
export async function listCloudFiles(folderId?: string | null, isGlobal = false): Promise<CloudFile[]> {
  try {
    const params = new URLSearchParams();
    if (folderId) {
      params.set('folderId', folderId);
    }
    if (isGlobal) {
      params.set('global', 'true');
    }

    const url = params.toString() ? `${getApiBase()}/files?${params}` : `${getApiBase()}/files`;
    const response = await fetch(url, {
      credentials: 'include',
    });

    if (!response.ok) {
      handleApiError(response, 'Failed to list files');
    }

    const data = await response.json();
    const files = data.files || [];
    cloudFiles.set(files);
    return files;
  } catch (error) {
    console.error('Failed to list cloud files:', error);
    throw error;
  }
}

/**
 * List folders in a parent folder
 * @param parentId - Parent folder ID. Omit for root level.
 * @param includeGlobal - If true, also return global folders
 */
export async function listCloudFolders(parentId?: string | null, includeGlobal = false): Promise<{ folders: CloudFolder[]; globalFolders: CloudFolder[] }> {
  try {
    const params = new URLSearchParams();
    if (parentId) {
      params.set('parentId', parentId);
    }
    if (includeGlobal) {
      params.set('includeGlobal', 'true');
    }

    const url = params.toString() ? `${getApiBase()}/folders?${params}` : `${getApiBase()}/folders`;
    const response = await fetch(url, {
      credentials: 'include',
    });

    if (!response.ok) {
      handleApiError(response, 'Failed to list folders');
    }

    const data = await response.json();
    const userFolders = data.folders || [];
    const sharedFolders = data.globalFolders || [];

    cloudFolders.set(userFolders);
    globalFolders.set(sharedFolders);

    return { folders: userFolders, globalFolders: sharedFolders };
  } catch (error) {
    console.error('Failed to list cloud folders:', error);
    throw error;
  }
}

/**
 * Create a new folder
 * @param folderName - Name of the folder
 * @param parentFolderId - Parent folder ID (null for root)
 * @param isGlobal - Create as global folder (admin only)
 */
export async function createFolder(
  folderName: string,
  parentFolderId?: string | null,
  isGlobal = false
): Promise<CloudFolder> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    const response = await fetch(`${getApiBase()}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        folderName,
        parentFolderId: parentFolderId || undefined,
        isGlobal,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to create folder');
    }

    const data = await response.json();
    cloudSyncStatus.set('idle');

    // Refresh folder list
    await listCloudFolders(parentFolderId);

    return data.folder;
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Rename a folder
 * @param folderId - Folder ID
 * @param newName - New folder name
 */
export async function renameFolder(folderId: string, newName: string): Promise<void> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    const response = await fetch(`${getApiBase()}/folders/${folderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: newName }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to rename folder');
    }

    cloudSyncStatus.set('idle');

    // Refresh current folder list
    const currentFolder = get(currentFolderId);
    await listCloudFolders(currentFolder);
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Delete a folder (must be empty)
 * @param folderId - Folder ID
 */
export async function deleteFolder(folderId: string): Promise<void> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    const response = await fetch(`${getApiBase()}/folders/${folderId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to delete folder');
    }

    cloudSyncStatus.set('idle');

    // Refresh current folder list
    const currentFolder = get(currentFolderId);
    await listCloudFolders(currentFolder);
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Move a file to a different folder
 * @param fileId - File ID
 * @param targetFolderId - Target folder ID (null for root)
 */
export async function moveFile(fileId: string, targetFolderId: string | null): Promise<void> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    const response = await fetch(`${getApiBase()}/files/${fileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderId: targetFolderId }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to move file');
    }

    cloudSyncStatus.set('idle');

    // Refresh file list
    const currentFolder = get(currentFolderId);
    await listCloudFiles(currentFolder);
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Navigate to a folder and update breadcrumbs
 * @param folderId - Folder ID to navigate to (null for root)
 * @param folderName - Folder name (used for breadcrumb)
 */
export async function navigateToFolder(folderId: string | null, folderName?: string): Promise<void> {
  currentFolderId.set(folderId);

  if (folderId === null) {
    // Navigate to root
    breadcrumbs.set([{ id: null, name: 'Root' }]);
  } else {
    // Add to breadcrumbs
    const current = get(breadcrumbs);
    const existingIndex = current.findIndex(b => b.id === folderId);

    if (existingIndex >= 0) {
      // Already in breadcrumbs, truncate to this point
      breadcrumbs.set(current.slice(0, existingIndex + 1));
    } else {
      // Add new breadcrumb
      breadcrumbs.set([...current, { id: folderId, name: folderName || 'Folder' }]);
    }
  }

  // Refresh content
  await Promise.all([
    listCloudFolders(folderId, folderId === null), // Include global at root
    listCloudFiles(folderId),
  ]);
}

/**
 * Refresh the current folder contents
 */
export async function refreshCurrentFolder(): Promise<void> {
  const folderId = get(currentFolderId);
  await Promise.all([
    listCloudFolders(folderId, folderId === null),
    listCloudFiles(folderId),
  ]);
}

/** Maximum file size for GPX uploads (10 MB) */
const MAX_GPX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Custom error class for upload quota exceeded
 */
export class QuotaExceededError extends Error {
  public readonly remaining: number;

  constructor(message: string, remaining: number) {
    super(message);
    this.name = 'QuotaExceededError';
    this.remaining = remaining;
  }
}

/**
 * Custom error class for file too large
 */
export class FileTooLargeError extends Error {
  public readonly maxSize: number;
  public readonly actualSize: number;

  constructor(message: string, maxSize: number, actualSize: number) {
    super(message);
    this.name = 'FileTooLargeError';
    this.maxSize = maxSize;
    this.actualSize = actualSize;
  }
}

/**
 * Save a GPX file to the cloud
 * @param gpxContent - The GPX XML content as a string
 * @param fileName - The user-facing file name
 * @param metadata - Optional metadata (track count, distance, etc.)
 * @param folderId - Optional folder ID to save to
 * @returns The cloud fileId
 * @throws {FileTooLargeError} If file exceeds 10 MB limit
 * @throws {QuotaExceededError} If upload quota is exceeded
 */
export async function saveToCloud(
  gpxContent: string,
  fileName: string,
  metadata?: {
    trackCount?: number;
    waypointCount?: number;
    totalDistance?: number;
    totalElevation?: number;
    // Con-day tag (Phase 60): ISO date "YYYY-MM-DD", one of CON_DAYS. Spread into
    // the create body; the server validates it (isConDay + not-future) and enforces
    // the per-con-day cap.
    conDay?: string;
  },
  folderId?: string | null
): Promise<string> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });

    // Client-side size check for better UX
    if (blob.size > MAX_GPX_FILE_SIZE) {
      throw new FileTooLargeError(
        `File too large: ${(blob.size / (1024 * 1024)).toFixed(1)} MB exceeds ${MAX_GPX_FILE_SIZE / (1024 * 1024)} MB limit`,
        MAX_GPX_FILE_SIZE,
        blob.size
      );
    }

    // Create file record and get presigned upload URL
    // POST /api/gpx/files creates the DynamoDB record AND returns presigned URL
    const presignResponse = await fetch(`${getApiBase()}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        fileName,
        fileSize: blob.size,
        folderId: folderId || undefined,
        ...metadata,
      }),
    });

    if (!presignResponse.ok) {
      if (presignResponse.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
      }
      if (presignResponse.status === 403) {
        throw new Error('Access denied - gpxstudio service required');
      }
      if (presignResponse.status === 413) {
        const data = await presignResponse.json().catch(() => ({}));
        throw new FileTooLargeError(
          data.message || 'File too large',
          data.maxSize || MAX_GPX_FILE_SIZE,
          blob.size
        );
      }
      if (presignResponse.status === 429) {
        const data = await presignResponse.json().catch(() => ({}));
        throw new QuotaExceededError(
          data.message || 'Upload quota exceeded',
          data.remaining ?? 0
        );
      }
      throw new Error('Failed to get upload URL');
    }

    const { uploadUrl, fileId } = await presignResponse.json();

    // Upload directly to S3
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/gpx+xml' },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file to storage');
    }

    // Confirm the upload (validates GPX content and activates the file)
    const confirmResponse = await fetch(`${getApiBase()}/files/${fileId}/confirm`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!confirmResponse.ok) {
      const data = await confirmResponse.json().catch(() => ({}));
      if (data.error === 'Invalid GPX file') {
        // Invalid uploads still consume quota to prevent abuse
        throw new Error(`Invalid GPX file: ${data.message || 'Unknown validation error'}. This upload counts against your quota.`);
      }
      // Non-critical: file is uploaded but confirmation failed
      // The file may still work, just log and continue
      console.warn('File uploaded but confirmation failed:', data.error);
    }

    cloudSyncStatus.set('idle');

    // Refresh file list for current folder
    const currentFolder = get(currentFolderId);
    await listCloudFiles(currentFolder);

    return fileId;
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Load a GPX file from the cloud
 * @param fileId - The cloud file ID
 * @returns The GPX content and file name
 */
export async function loadFromCloud(fileId: string): Promise<{ content: string; fileName: string }> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    // Get presigned download URL
    const presignResponse = await fetch(`${getApiBase()}/download/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fileId }),
    });

    if (!presignResponse.ok) {
      if (presignResponse.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
      }
      if (presignResponse.status === 404) {
        throw new Error('File not found');
      }
      throw new Error('Failed to get download URL');
    }

    const { downloadUrl, fileName } = await presignResponse.json();

    // Download from S3
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      throw new Error('Failed to download file from storage');
    }

    const content = await downloadResponse.text();
    cloudSyncStatus.set('idle');

    return { content, fileName };
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Delete a file from the cloud
 * @param fileId - The cloud file ID
 */
export async function deleteFromCloud(fileId: string): Promise<void> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    const response = await fetch(`${getApiBase()}/files/${fileId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
      }
      if (response.status === 404) {
        throw new Error('File not found');
      }
      throw new Error('Failed to delete file');
    }

    cloudSyncStatus.set('idle');

    // Refresh file list for current folder
    const currentFolder = get(currentFolderId);
    await listCloudFiles(currentFolder);
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Update file metadata (e.g., rename)
 * @param fileId - The cloud file ID
 * @param updates - Fields to update
 */
export async function updateCloudFile(
  fileId: string,
  updates: { fileName?: string; folderId?: string | null; conDay?: string | null }
): Promise<void> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    const response = await fetch(`${getApiBase()}/files/${fileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
      }
      // Surface the server's specific message (e.g. the 429 "you've logged all
      // N runs for that day" from a conDay move) instead of a generic error.
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || data.error || 'Failed to update file');
    }

    cloudSyncStatus.set('idle');

    // Refresh file list for current folder
    const currentFolder = get(currentFolderId);
    await listCloudFiles(currentFolder);
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Update file content (overwrite existing file in S3)
 * @param fileId - The cloud file ID
 * @param gpxContent - The new GPX XML content
 * @param metadata - Optional metadata updates
 */
export async function updateCloudFileContent(
  fileId: string,
  gpxContent: string,
  metadata?: {
    fileName?: string;
    fileSize?: number;
    trackCount?: number;
    waypointCount?: number;
    totalDistance?: number;
    totalElevation?: number;
  }
): Promise<void> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });

    // Request presigned upload URL for existing file
    const response = await fetch(`${getApiBase()}/files/${fileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        updateContent: true,
        fileSize: blob.size,
        ...metadata,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
      }
      if (response.status === 404) {
        throw new Error('File not found');
      }
      throw new Error('Failed to get upload URL');
    }

    const { uploadUrl } = await response.json();

    if (!uploadUrl) {
      throw new Error('No upload URL returned');
    }

    // Upload new content to S3
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/gpx+xml' },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file to storage');
    }

    cloudSyncStatus.set('idle');

    // Refresh file list for current folder
    const currentFolder = get(currentFolderId);
    await listCloudFiles(currentFolder);
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}

/**
 * Find an existing cloud file by name in the current folder
 * @param fileName - The file name to search for
 * @returns The matching CloudFile or undefined
 */
export function findCloudFileByName(fileName: string): CloudFile | undefined {
  const files = get(cloudFiles);
  return files.find(f => f.fileName === fileName);
}

/**
 * Save or update a GPX file to the cloud
 * If a file with the same name exists in the current folder, it will be overwritten.
 * Otherwise, a new file is created.
 * @param gpxContent - The GPX XML content
 * @param fileName - The file name
 * @param metadata - Optional metadata
 * @param folderId - Optional folder ID
 * @returns Object with fileId and whether it was an update
 */
export async function saveOrUpdateToCloud(
  gpxContent: string,
  fileName: string,
  metadata?: {
    trackCount?: number;
    waypointCount?: number;
    totalDistance?: number;
    totalElevation?: number;
    conDay?: string;
  },
  folderId?: string | null
): Promise<{ fileId: string; wasUpdate: boolean }> {
  // Check if file with same name exists in current folder
  const existingFile = findCloudFileByName(fileName);

  if (existingFile) {
    // Update existing file
    await updateCloudFileContent(existingFile.fileId, gpxContent, {
      fileName,
      ...metadata,
    });
    return { fileId: existingFile.fileId, wasUpdate: true };
  } else {
    // Create new file
    const fileId = await saveToCloud(gpxContent, fileName, metadata, folderId);
    return { fileId, wasUpdate: false };
  }
}

/**
 * Fetch version history for a file
 * @param fileId - The cloud file ID
 * @returns Array of versions with existence info and current version number
 */
export async function getFileVersions(fileId: string): Promise<{ versions: FileVersion[]; current: number }> {
  try {
    const response = await fetch(`${getApiBase()}/files/${fileId}/versions`, {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
      }
      if (response.status === 404) {
        throw new Error('File not found');
      }
      throw new Error('Failed to get versions');
    }

    const data = await response.json();
    return {
      versions: data.versions || [],
      current: data.current || 1,
    };
  } catch (error) {
    console.error('Failed to get file versions:', error);
    throw error;
  }
}

/**
 * Load a specific version of a GPX file from the cloud
 * @param fileId - The cloud file ID
 * @param version - The version number to load
 * @returns The GPX content and file name
 */
export async function loadVersionFromCloud(fileId: string, version: number): Promise<{ content: string; fileName: string }> {
  cloudSyncStatus.set('syncing');
  cloudSyncError.set(null);

  try {
    // Get presigned download URL for specific version
    const presignResponse = await fetch(`${getApiBase()}/download/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fileId, version }),
    });

    if (!presignResponse.ok) {
      if (presignResponse.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
      }
      if (presignResponse.status === 404) {
        throw new Error('File or version not found');
      }
      throw new Error('Failed to get download URL');
    }

    const { downloadUrl, fileName } = await presignResponse.json();

    // Download from S3
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      throw new Error('Failed to download file from storage');
    }

    const content = await downloadResponse.text();
    cloudSyncStatus.set('idle');

    return { content, fileName };
  } catch (error) {
    cloudSyncStatus.set('error');
    const message = error instanceof Error ? error.message : 'Unknown error';
    cloudSyncError.set(message);
    throw error;
  }
}
