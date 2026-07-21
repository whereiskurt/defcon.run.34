import { routeColor } from '$lib/dc34-palette';

/**
 * Shared click-popup builder for a DEF CON run track — used by BOTH
 * my-con-runs.ts (the read-only "My DEF CON Runs" overlay) and gpx-layer.ts
 * (the editable gpx-studio file track a Strava import actually lands as; UAT
 * round 2 fix B). Kept as its own leaf module — deliberately with NO import of
 * public-overlays.ts or gpx-layer.ts — because gpx-layer.ts needs to import
 * this, and public-overlays.ts already imports gpx-layer.ts (for
 * getSvgForSymbol); routing this through either of those would create an
 * import cycle. `prettyName` below duplicates public-overlays.ts's
 * `prettyRouteName` (strip ".gpx") for the same reason.
 *
 * Also holds the cross-layer bridge state gpx-layer.ts reads to recognize a
 * cloud-linked file as a con-day-tagged run: `conRunDayColors` (conDay -> the
 * same fixed color MyConRunsLayer assigned it) and `conRunMetaByFileId` (cloud
 * fileId -> {conDay, fileName, totalDistance} from the con-runs manifest).
 * Populated by my-con-runs.ts's load()/reload(), cleared on remove().
 */

export const conRunDayColors = new Map<string, string>();
export const conRunMetaByFileId = new Map<
    string,
    { conDay: string; fileName: string; totalDistance?: number }
>();

function prettyName(fileName: string): string {
    return fileName.replace(/\.gpx$/i, '').trim() || fileName;
}

function formatDistance(meters?: number): string | undefined {
    if (!meters || meters <= 0) return undefined;
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
    );
}

/** Compact day-chip label, e.g. "Fri · Aug 7". */
function dayChipLabel(conDay: string): string {
    const d = new Date(conDay + 'T12:00:00');
    const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
    const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${weekday} · ${monthDay}`;
}

/** A small pill showing the weekday+date in the day's color when tagged, or a
 * muted "No day assigned" pill when untagged. */
export function dayChipHtml(conDay: string | null | undefined, color?: string): string {
    if (!conDay) {
        return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(148,148,168,.18);color:#9a9aa8;border:1px solid rgba(148,148,168,.3)">No day assigned</span>`;
    }
    const bg = color ?? routeColor(0);
    return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;background:${bg};color:#0b0b12">${escapeHtml(dayChipLabel(conDay))}</span>`;
}

/** Build the click-popup HTML: eyebrow + name + distance + DEF CON day chip.
 * Styled like the existing route popups (border-left color bar, eyebrow, name,
 * meta row — see StravaStrip.svelte's trackPopupHtml). */
export function runPopupHtml(
    fileName: string,
    conDay: string | null | undefined,
    color: string,
    totalDistance?: number
): string {
    const distStr = formatDistance(totalDistance);
    return `
        <div style="min-width:180px;max-width:260px;padding:10px 12px;border-left:4px solid ${color};
                    font-family:system-ui,sans-serif;color:#e4e4ef">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">My DEF CON Run</div>
            <div style="font-size:15px;font-weight:600;margin-top:2px">${escapeHtml(prettyName(fileName))}</div>
            ${distStr ? `<div style="font-size:12px;opacity:.85;margin-top:6px">📏 ${distStr}</div>` : ''}
            <div style="margin-top:8px">${dayChipHtml(conDay, color)}</div>
        </div>`;
}
