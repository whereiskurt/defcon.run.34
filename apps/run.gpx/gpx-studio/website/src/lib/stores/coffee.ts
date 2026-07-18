import { writable } from 'svelte/store';

/**
 * Whether the giant PublicUs coffee cup has been "unlocked" this session.
 * Default off. The cup is ALWAYS visible (tilt-revealed, translucent) — unlock
 * is a *bonus*: it bumps the cup toward opaque and switches steam on.
 *
 * Flipped on by searching `publicus` or `coffee` in the map's geocoder (see the
 * externalGeocoder hook in components/map/map.ts) — a search-box trigger works
 * on both mobile and desktop, unlike the rainbow egg's typed keyword.
 */
export const coffeeUnlocked = writable(false);
