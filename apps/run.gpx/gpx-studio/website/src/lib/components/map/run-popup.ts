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
 * meta row — see StravaStrip.svelte's trackPopupHtml). When `removeFileId` is
 * given (my-con-runs.ts — the runner's OWN runs only), a "Remove run" button
 * is rendered; wire it with wireRunPopupRemove after the popup is added. */
export function runPopupHtml(
    fileName: string,
    conDay: string | null | undefined,
    color: string,
    totalDistance?: number,
    removeFileId?: string
): string {
    const distStr = formatDistance(totalDistance);
    const removeBtn = removeFileId
        ? `<button data-remove-run="${escapeHtml(removeFileId)}"
                   style="display:block;width:100%;margin-top:10px;padding:5px 8px;border-radius:8px;
                          font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;
                          background:transparent;color:#f87171;border:1px solid rgba(248,113,113,.35)">
               Remove run</button>`
        : '';
    return `
        <div style="min-width:180px;max-width:260px;padding:10px 12px;border-left:4px solid ${color};
                    font-family:system-ui,sans-serif;color:#e4e4ef">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">My DEF CON Run</div>
            <div style="font-size:15px;font-weight:600;margin-top:2px">${escapeHtml(prettyName(fileName))}</div>
            ${distStr ? `<div style="font-size:12px;opacity:.85;margin-top:6px">📏 ${distStr}</div>` : ''}
            <div style="margin-top:8px">${dayChipHtml(conDay, color)}</div>
            ${removeBtn}
        </div>`;
}

/**
 * Attach the two-step "Remove run" confirm to a just-opened popup element.
 * First click arms the button ("Really remove?"); second click calls
 * `onRemove` (which deletes the cloud file — a Strava import becomes
 * re-selectable in the strip, since dedupe joins the live file index).
 * `onRemove` resolves false on failure so the button can offer a retry.
 */
export function wireRunPopupRemove(
    container: HTMLElement | undefined,
    onRemove: (fileId: string) => Promise<boolean>
): void {
    const btn = container?.querySelector<HTMLButtonElement>('[data-remove-run]');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const fileId = btn.dataset.removeRun;
        if (!fileId) return;
        if (btn.dataset.armed !== '1') {
            btn.dataset.armed = '1';
            btn.textContent = 'Really remove? This deletes the run.';
            btn.style.background = 'rgba(248,113,113,.15)';
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Removing…';
        void onRemove(fileId).then((ok) => {
            if (!ok) {
                btn.disabled = false;
                btn.dataset.armed = '';
                btn.style.background = 'transparent';
                btn.textContent = 'Remove failed — try again';
            }
        });
    });
}
