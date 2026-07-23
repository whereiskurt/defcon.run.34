import { writable } from 'svelte/store';

/**
 * Whether the hidden "Rainbow Bridges" easter egg has been unlocked this
 * session. Default off. Flipped on by a rapid 3D tilt-flip gesture (see the
 * flip detector wired into `map.toggle3D()` in components/map/map.ts), which
 * mirrors the ghost-mode gesture pattern in stores/ghost.ts.
 *
 * Even once unlocked the arches only *render* when the map is pitched — the
 * reveal is pitch-driven (see rainbow-geometry.ts `pitchOpacity`). So the egg
 * is doubly hidden: unlock, then tilt.
 */
export const rainbowUnlocked = writable(false);

/**
 * Arch ids force-shown this session, independent of the master rainbow unlock.
 * Default none. Searching an arch's keyword in the map's geocoder *toggles* it
 * (see ARCH_SEARCH_WORDS in components/map/rainbow-geometry.ts and the
 * externalGeocoder hook in components/map/map.ts) — search again to hide. Like
 * every arch they're still pitch-revealed — tilt the map to see the arch bloom.
 */
export const forcedArchIds = writable<string[]>([]);

/** Toggle one arch id in/out of the forced-shown set. */
export function toggleForcedArch(id: string) {
    forcedArchIds.update((ids) =>
        ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]
    );
}

// The rolling-window gesture detector lives in stores/ghost.ts; the toggle3D
// hook imports `recordHit` from there directly so we keep one implementation.
