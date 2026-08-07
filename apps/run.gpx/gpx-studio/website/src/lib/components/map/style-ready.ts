import type mapboxgl from 'mapbox-gl';

/**
 * How long to wait for the style before proceeding anyway.
 *
 * RESOLVING ON TIMEOUT IS DELIBERATE — this must never reject. A map that never
 * reaches a ready style (a style load that failed, a tab backgrounded before the
 * first render) used to leave the promise unsettled forever, so the `await` in
 * the caller never returned and that layer was silently lost, with no timeout
 * and no rejection to notice it by (IN-05, found in heatmap-layer). Rejecting
 * instead would only move the problem: the callers' `catch` would swallow it and
 * the layer would be lost just as silently.
 *
 * Proceeding early is safe because readiness is a HINT, not a precondition: the
 * `getSource` / `getLayer` guards in every caller already tolerate a style that
 * is not quite ready, so the worst case of going early is a no-op, while the
 * worst case of waiting forever is a wedged layer.
 */
export const STYLE_READY_TIMEOUT_MS = 10_000;

/**
 * Resolve once the style (including the async basemap import) can accept
 * sources and layers.
 *
 * ── why not `idle` (fixed 2026-08-07) ──────────────────────────────────────
 * Every layer module used to gate on `map.once('idle')`. That is the wrong
 * event by a wide margin: mapbox fires `idle` only once **every tile in the
 * viewport has downloaded AND rendered** and no transition is in flight. On a
 * slow link that is tens of seconds, and it is *unbounded* — it scales with the
 * viewer's bandwidth, not with the style. Since every DEF CON layer awaited it
 * before adding anything, the route overlays, aggregate and check-ins all
 * landed dead last on a cold load, long after the map was interactive.
 *
 * What the gate actually needs is much weaker: "can I call addSource/addLayer
 * without throwing?" — which is exactly `isStyleLoaded()`. So we watch the
 * events that signal a style-state change and settle on the first one where
 * `isStyleLoaded()` is true:
 *
 *   - `style.import.load` — the basemap import finishing, which is the specific
 *     thing the old comments were worried about racing (see map.ts, which
 *     already listens for it to reinstate glyphs).
 *   - `styledata` — the general "style changed" signal; covers a style with no
 *     imports at all, where `style.import.load` never fires.
 *   - `idle` — kept purely as a backstop, since a map that reaches idle is
 *     unambiguously ready. It is now the slowest path rather than the only one.
 *   - a timeout — see STYLE_READY_TIMEOUT_MS above.
 *
 * `styledata` and `style.import.load` both fire repeatedly while a style loads,
 * so the `isStyleLoaded()` re-check inside the handler is load-bearing: it is
 * what distinguishes "a style event happened" from "the style is usable".
 */
export function whenStyleReady(
    map: mapboxgl.Map,
    timeoutMs: number = STYLE_READY_TIMEOUT_MS
): Promise<void> {
    if (map.isStyleLoaded()) return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;

        const settle = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            map.off('style.import.load', onStyleEvent);
            map.off('styledata', onStyleEvent);
            map.off('idle', settle);
            resolve();
        };

        // A style event only means the style CHANGED, not that it is usable.
        const onStyleEvent = () => {
            if (map.isStyleLoaded()) settle();
        };

        const timer = setTimeout(settle, timeoutMs);
        map.on('style.import.load', onStyleEvent);
        map.on('styledata', onStyleEvent);
        map.on('idle', settle);
    });
}
