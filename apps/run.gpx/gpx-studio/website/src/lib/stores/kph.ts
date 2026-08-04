import { writable } from 'svelte/store';

/**
 * Whether the secret KPH payphone (LVCC, red) is shown. Default off.
 *
 * Deliberately a SEPARATE store from `payphonesShown`: the four public booths
 * reveal on "2600"/"phone(s)"/"1800" or #-#-#, and this one must stay dark
 * through all of those. It is toggled ONLY by `kph` — typed anywhere
 * (GhostTrigger.svelte, desktop) or searched in the map geocoder
 * (components/map/map.ts, mobile) — the same two-path split the rainbow
 * arches and the deuce use.
 */
export const kphShown = writable(false);

export function toggleKph() {
    kphShown.update((v) => !v);
}
