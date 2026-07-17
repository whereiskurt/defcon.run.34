/**
 * "Sync my Strava" door (Phase 61).
 *
 * Client helper for the log-a-run sub-flow's Strava button. Calls the
 * session-authenticated POST /api/gpx/strava/sync, which imports the signed-in
 * runner's recent Strava activities into their cloud folder tagged to the chosen
 * con-day (server-side: dedupe + per-con-day cap + lifetime quota + burst guard).
 * The route returns the created file descriptors; here we fetch each one back,
 * render it on the map, and register it for auto-save — mirroring how the Upload
 * door lands files (see logRunFromFile in logic/file-actions.ts).
 *
 * This lives in a NEW file (not file-actions.ts) to respect Phase 61's file
 * boundaries; it imports the shared fileActions/boundsManager/selection helpers.
 */

import { parseGPX, type GPXFile } from 'gpx';
import { fileActions } from '$lib/logic/file-actions';
import { boundsManager } from '$lib/logic/bounds';
import { selection } from '$lib/logic/selection';
import { autoSaveManager } from '$lib/auto-save';
import {
    getApiBase,
    loadFromCloud,
    AuthenticationError,
    redirectToLogin,
} from '$lib/cloud-sync';

/** Summary shown to the runner after a sync. */
export interface StravaSyncResult {
    imported: number;
    skipped: number;
    conDayRemaining: number;
}

/** A sync that failed with a user-presentable message (quota, cap, not-linked…). */
export class StravaSyncError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StravaSyncError';
    }
}

/**
 * Sync the signed-in runner's recent Strava activities into `conDay`, then land the
 * newly-imported routes on the map. Returns a summary for the card; throws
 * StravaSyncError with a friendly message on a handled failure, or
 * AuthenticationError (after redirecting) on an expired session.
 */
export async function logRunFromStrava(conDay: string): Promise<StravaSyncResult> {
    const response = await fetch(`${getApiBase()}/strava/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ conDay }),
    });

    if (!response.ok) {
        if (response.status === 401) {
            redirectToLogin();
            throw new AuthenticationError('Session expired. Redirecting to login...');
        }
        const data = await response.json().catch(() => ({}));
        throw new StravaSyncError(data.message || data.error || 'Strava sync failed');
    }

    const data = (await response.json()) as {
        imported: number;
        skipped: number;
        conDayRemaining: number;
        files: { fileId: string; fileName: string }[];
    };

    // Fetch each freshly-created route back from the cloud and render it. The
    // server already persisted them, so this is load-and-register only (no re-save).
    const gpxFiles: GPXFile[] = [];
    const descriptors: { fileId: string; fileName: string }[] = [];
    for (const f of data.files ?? []) {
        try {
            const { content, fileName } = await loadFromCloud(f.fileId);
            const gpx = parseGPX(content);
            if (gpx.metadata === undefined) {
                gpx.metadata = {};
            }
            if (gpx.metadata.name === undefined || gpx.metadata.name.trim() === '') {
                gpx.metadata.name = fileName.replace(/\.gpx$/i, '');
            }
            gpxFiles.push(gpx);
            descriptors.push({ fileId: f.fileId, fileName });
        } catch (e) {
            // A single load failure shouldn't abort the whole batch — it's already
            // saved and visible in My Maps; just skip rendering this one.
            console.warn('Failed to load imported Strava route', f.fileId, e);
        }
    }

    if (gpxFiles.length > 0) {
        const ids = fileActions.addMultiple(gpxFiles);
        ids.forEach((localId, i) => {
            // Strava imports save to the root folder server-side (folderId null).
            autoSaveManager.registerCloudLinkedFile(
                localId,
                descriptors[i].fileId,
                descriptors[i].fileName,
                null,
                false
            );
        });
        selection.selectFileWhenLoaded(ids[0]);
        boundsManager.fitBoundsOnLoad(ids);
    }

    return {
        imported: data.imported,
        skipped: data.skipped,
        conDayRemaining: data.conDayRemaining,
    };
}
