import { writable } from 'svelte/store';

/**
 * Whether the hidden B-Sides Las Vegas shuttle layer is shown, and — importantly
 * — HOW it was revealed.
 *
 * WHY THIS IS NOT A BOOLEAN. Revealing the layer fires the covert
 * `bsides-shuttle` award, exactly like the deuce and kph eggs. Once the layer
 * also became deep-linkable (`?layers=shuttles`), a plain boolean would have
 * meant anyone signed in who opened a shared link collected the flag just by
 * following it — the egg would stop being earned the first time the link was
 * pasted into a chat.
 *
 * So the store carries the provenance:
 *   'earned'  found it — searched "bsides"/"shuttle" or typed "bsides". Scores.
 *   'link'    arrived via ?layers=shuttles. Shows the buses, awards nothing.
 *   false     hidden.
 *
 * `LayerControl.svelte` is the only place that reads the distinction; everything
 * else just needs truthiness.
 */
export type ShuttleReveal = false | 'earned' | 'link';

export const shuttlesShown = writable<ShuttleReveal>(false);

/**
 * The discovery path — geocoder search (mobile) or the typed "bsides" gesture
 * (desktop), mirroring the deuce/payphone/kph split. This is the one that pays.
 */
export function toggleShuttles() {
    shuttlesShown.update((v) => (v ? false : 'earned'));
}

/** Deep-link reveal. Idempotent, and deliberately does not award the flag. */
export function revealShuttlesFromLink() {
    shuttlesShown.set('link');
}
