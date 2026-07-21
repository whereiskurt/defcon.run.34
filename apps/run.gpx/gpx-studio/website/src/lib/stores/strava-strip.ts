import { writable } from 'svelte/store';

/**
 * Strava strip UI state (2026-07-21 spec). Expanded/collapsed persists per
 * browser; openStravaStrip() is the QuickStart hub's "From Strava" hand-off —
 * it force-expands the strip (and the strip component scrolls itself into view).
 *
 * Default is COLLAPSED when there's no saved preference yet: the strip must
 * never auto-fetch on page load (fetching burns the lifetime strava_sync
 * quota), and defaulting to collapsed keeps a first-time expand behind an
 * explicit user action (chevron click / hub pulse / fallback button). Once a
 * value is persisted, it always wins.
 */
const KEY = 'stravaStripExpanded';

function initial(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(KEY) === '1';
}

export const stravaStripExpanded = writable<boolean>(initial());
stravaStripExpanded.subscribe((v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v ? '1' : '0');
});

/**
 * Fully hidden (the header X, Kurt 2026-07-21): the strip disappears from the
 * map entirely, persisted per browser. The way back is the QuickStart hub's
 * "From Strava" button — openStravaStrip() always un-hides.
 */
const HIDDEN_KEY = 'stravaStripHidden';

function initialHidden(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(HIDDEN_KEY) === '1';
}

export const stravaStripHidden = writable<boolean>(initialHidden());
stravaStripHidden.subscribe((v) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HIDDEN_KEY, v ? '1' : '0');
});

/** One-shot attention pulse fired when the hub button opens the strip. */
export const stravaStripPulse = writable<number>(0);

export function openStravaStrip(): void {
    stravaStripHidden.set(false);
    stravaStripExpanded.set(true);
    stravaStripPulse.update((n) => n + 1);
}
