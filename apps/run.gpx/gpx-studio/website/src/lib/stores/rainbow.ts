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
 * Whether the green "weed" arch → NuWu is force-shown this session, independent
 * of the master rainbow unlock. Default off. Searching `weed` in the map's
 * geocoder *toggles* it (see the externalGeocoder hook in components/map/map.ts),
 * so typing "weed" again hides it. Like every arch it's still pitch-revealed — you
 * tilt the map to see the arch bloom.
 */
export const weedShown = writable(false);

// The rolling-window gesture detector lives in stores/ghost.ts; the toggle3D
// hook imports `recordHit` from there directly so we keep one implementation.
