import { writable } from 'svelte/store';

/**
 * Whether the hidden PayPhone booths are shown. Default off. Toggled by
 * searching "2600" / "phone" / "phones" / "1800" in the map geocoder
 * (components/map/map.ts) or pressing #-#-# quickly anywhere
 * (GhostTrigger.svelte) — search covers mobile, the key gesture covers
 * desktop, mirroring the deuce split.
 */
export const payphonesShown = writable(false);

export function togglePayphones() {
    payphonesShown.update((v) => !v);
}
