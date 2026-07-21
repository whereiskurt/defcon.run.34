/**
 * Strava strip client (2026-07-21 spec; supersedes the Phase 61 bulk door).
 *
 * fetchStravaActivities() lists the runner's last-7-days activities for the
 * bottom strip; importStravaActivity() imports ONE tapped activity tagged to a
 * con day and lands it on the map exactly the way the Upload door does. The
 * old all-at-once logRunFromStrava() is retired — the QuickStart hub button now
 * just opens the strip.
 */

import { parseGPX } from 'gpx';
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

export interface StripActivity {
    id: number;
    name: string;
    type: string;
    startDateLocal: string;
    distanceMeters: number;
    movingTimeSeconds: number;
    summaryPolyline: string;
    imported: boolean;
}

/** A call that failed with a user-presentable message (quota, cap, not-linked…). */
export class StravaSyncError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StravaSyncError';
    }
}

async function throwFromResponse(response: Response, fallback: string): Promise<never> {
    if (response.status === 401) {
        redirectToLogin();
        throw new AuthenticationError('Session expired. Redirecting to login...');
    }
    const data = await response.json().catch(() => ({}));
    throw new StravaSyncError(data.message || data.error || fallback);
}

/** List the runner's last-7-days Strava activities for the strip. */
export async function fetchStravaActivities(): Promise<StripActivity[]> {
    const response = await fetch(`${getApiBase()}/strava/activities`, {
        credentials: 'include',
    });
    if (!response.ok) await throwFromResponse(response, 'Could not load Strava activities');
    const data = (await response.json()) as { activities: StripActivity[] };
    return data.activities ?? [];
}

/** Land one freshly-created cloud file on the map (Upload-door landing chain). */
export async function landCloudFileOnMap(descriptor: {
    fileId: string;
    fileName: string;
}): Promise<void> {
    const { content, fileName } = await loadFromCloud(descriptor.fileId);
    const gpx = parseGPX(content);
    if (gpx.metadata === undefined) gpx.metadata = {};
    if (gpx.metadata.name === undefined || gpx.metadata.name.trim() === '') {
        gpx.metadata.name = fileName.replace(/\.gpx$/i, '');
    }
    const ids = fileActions.addMultiple([gpx]);
    // Strava imports save to the root folder server-side (folderId null).
    autoSaveManager.registerCloudLinkedFile(ids[0], descriptor.fileId, fileName, null, false);
    selection.selectFileWhenLoaded(ids[0]);
    boundsManager.fitBoundsOnLoad(ids);
}

/** Import ONE tapped activity into `conDay`, then render it on the map. */
export async function importStravaActivity(
    activityId: number,
    conDay: string
): Promise<{ fileId: string; fileName: string; conDayRemaining: number }> {
    const response = await fetch(`${getApiBase()}/strava/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ activityId, conDay }),
    });
    if (!response.ok) await throwFromResponse(response, 'Strava import failed');
    const data = (await response.json()) as {
        file: { fileId: string; fileName: string };
        conDayRemaining: number;
    };
    await landCloudFileOnMap(data.file);
    return { ...data.file, conDayRemaining: data.conDayRemaining };
}
