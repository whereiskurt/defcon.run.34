/**
 * Strava strip client (2026-07-21 spec; supersedes the Phase 61 bulk door).
 *
 * fetchStravaActivities() lists the runner's last-7-days activities for the
 * bottom strip; importStravaActivity() imports ONE tapped activity tagged to a
 * con day. Since UAT round 3 fix B, the client no longer lands it as a second,
 * editable gpx-studio file — the strip presents the import via the My DEF CON
 * Runs layer instead (`revealConRun`/`myConRunsReveal`). landCloudFileOnMap()
 * below is kept exported (no current callers) for any future My Maps
 * open-file flow that needs the same landing chain the Upload door used.
 * The old all-at-once logRunFromStrava() is retired — the QuickStart hub
 * button now just opens the strip.
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
    // Present only when `imported` — `conDay` is a date string once tagged, or
    // null for an untagged import (server: fileId?: string; conDay?: string | null).
    fileId?: string;
    conDay?: string | null;
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

/**
 * List the runner's recent Strava activities for the strip. The server starts
 * at the last 7 days and backfills whole weeks until the ribbon has enough
 * activities (server-controlled); `weeks` reports how far back it looked.
 *
 * Served from the per-user server-side cache by default — free (no
 * strava_sync quota, no Strava traffic), refreshed for everyone by the
 * twice-daily background sync. `refresh: true` (the strip's Refresh button)
 * bypasses the cache and performs a real Strava fetch, which consumes one
 * strava_sync unit; a first-ever load with no cache yet does the same.
 * `fetchedAt` (epoch ms) says when the returned snapshot was pulled.
 */
export async function fetchStravaActivities(opts?: { refresh?: boolean }): Promise<{
    activities: StripActivity[];
    weeks: number;
    cached: boolean;
    fetchedAt: number | null;
}> {
    const suffix = opts?.refresh ? '?refresh=1' : '';
    const response = await fetch(`${getApiBase()}/strava/activities${suffix}`, {
        credentials: 'include',
    });
    if (!response.ok) await throwFromResponse(response, 'Could not load Strava activities');
    const data = (await response.json()) as {
        activities: StripActivity[];
        weeks?: number;
        cached?: boolean;
        fetchedAt?: number;
    };
    return {
        activities: data.activities ?? [],
        weeks: data.weeks ?? 1,
        cached: data.cached ?? false,
        fetchedAt: data.fetchedAt ?? null,
    };
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

/** Import ONE tapped activity into `conDay`. The server creates the cloud file
 * (unchanged); the client no longer lands it as a second, editable gpx-studio
 * file (UAT round 3 fix B) — the caller (StravaStrip) presents it via the My
 * DEF CON Runs layer instead (`revealConRun`/`myConRunsReveal`), so a
 * con-day-tagged import shows exactly one representation on the map, not two. */
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
    return { ...data.file, conDayRemaining: data.conDayRemaining };
}

/**
 * Header "Sync now" action — imports the runner's last 7 days UNTAGGED,
 * capped at 2/day (see /api/gpx/strava/sync-now). A 429 at the cap surfaces
 * its `.message` via the shared throwFromResponse idiom.
 */
export async function syncNowStrava(): Promise<{
    imported: number;
    skipped: number;
    remainingToday: number;
}> {
    const response = await fetch(`${getApiBase()}/strava/sync-now`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) await throwFromResponse(response, 'Strava sync failed');
    const data = (await response.json()) as {
        imported: number;
        skipped: number;
        remainingToday: number;
    };
    return data;
}
