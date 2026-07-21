import { writable } from 'svelte/store';

/**
 * Strava strip UI state (2026-07-21 spec). Expanded/collapsed persists per
 * browser; openStravaStrip() is the QuickStart hub's "From Strava" hand-off —
 * it force-expands the strip (and the strip component scrolls itself into view).
 */
const KEY = 'stravaStripExpanded';

function initial(): boolean {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(KEY) !== '0';
}

export const stravaStripExpanded = writable<boolean>(initial());
stravaStripExpanded.subscribe((v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v ? '1' : '0');
});

/** One-shot attention pulse fired when the hub button opens the strip. */
export const stravaStripPulse = writable<number>(0);

export function openStravaStrip(): void {
    stravaStripExpanded.set(true);
    stravaStripPulse.update((n) => n + 1);
}
