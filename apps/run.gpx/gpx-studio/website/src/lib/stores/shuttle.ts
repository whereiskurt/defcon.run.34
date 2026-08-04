import { writable } from 'svelte/store';

/**
 * Whether the hidden B-Sides Las Vegas shuttle layer is shown. Default off.
 * Toggled by searching "bsides" / "b-sides" / "shuttle" in the map geocoder
 * (components/map/map.ts) or typing "bsides" anywhere (GhostTrigger.svelte) —
 * search covers mobile, the typed word covers desktop, mirroring the
 * deuce/payphone/kph split.
 */
export const shuttlesShown = writable(false);

export function toggleShuttles() {
    shuttlesShown.update((v) => !v);
}
