import { writable } from 'svelte/store';

/**
 * Whether the hidden Deuce bus layer is shown. Default off. Toggled by
 * searching "deuce" in the map geocoder (components/map/map.ts) or pressing
 * 2-2-2 quickly anywhere (GhostTrigger.svelte) — search covers mobile, the
 * key gesture covers desktop, mirroring the coffee/dd split.
 */
export const deuceShown = writable(false);

export function toggleDeuce() {
    deuceShown.update((v) => !v);
}
