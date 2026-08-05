import mapboxgl from 'mapbox-gl';
import { writable } from 'svelte/store';
import { shuttleSvg, type ShuttleFace } from './shuttle-svg';
import { ticketHtml } from './shuttle-ticket';
import { openEggModal } from './egg-modal';

const SHUTTLE_EGG_ID = 'dc34-bsides-shuttle';
const POLL_MS = 45_000;

/**
 * A bus that has not reported for this long is drawn asleep.
 *
 * Mirrors STALE_AFTER_MS in the webapp's `lib/bsides-shuttles.ts`. The studio is
 * a separate package and cannot import from the webapp, so the threshold is
 * restated rather than shared — it is one number, and the alternative is a build
 * dependency between the two trees. The ticket's "VOID 30 MINUTES AFTER LAST
 * TELEMETRY" fine print is this value.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

const FALLBACK_HEX = '#94A3B8';

/**
 * Last-resort position: the Tuscany lot the fleet parks in. Mirrors
 * TUSCANY_ANCHOR in the webapp's `lib/bsides-shuttles.ts` (separate package, so
 * it is restated rather than imported). The proxy already anchors positionless
 * buses, so this only guards a feature arriving with no geometry at all — and a
 * Marker MUST have a position before it is added to the map or `addTo` throws.
 */
const TUSCANY_ANCHOR: [number, number] = [-115.160809, 36.112728];

/** Region prefix = path before '/studio' (mirrors rabbit-layer's rabbitUrl). */
function shuttleUrl(): string {
    const path = window.location.pathname;
    const i = path.indexOf('/studio');
    const prefix = i > 0 ? path.slice(0, i) : '';
    return `${prefix}/api/gpx/public/shuttles`;
}

/** Which face a bus wears, from its reported speed and fix age. */
export function faceFor(kmh: number, lastFixMs: number | null, nowMs: number): ShuttleFace {
    if (lastFixMs === null) return 'nofix';
    if (nowMs - lastFixMs > STALE_AFTER_MS) return 'sleeping';
    return kmh > 1 ? 'moving' : 'parked';
}

/**
 * The glyph is drawn nose-right, so a bus heading into the western half of the
 * compass is mirrored. Bearings are 0=N, 90=E: westbound is 180..360.
 */
export function facesLeft(hdg: number): boolean {
    const h = ((hdg % 360) + 360) % 360;
    return h > 180 && h < 360;
}

export type ShuttleState = { available: boolean; visible: boolean; count: number };

export const shuttleState = writable<ShuttleState>({
    available: false,
    visible: false,
    count: 0,
});

type Bus = {
    marker: mapboxgl.Marker;
    el: HTMLDivElement;
    /** Last rendered signature, so we only re-innerHTML when the art changes. */
    sig: string;
    /** Last fix timestamp seen, to detect a genuinely new report. */
    lastFixMs: number | null;
};

/**
 * ShuttleLayer — the B-Sides Las Vegas shuttle fleet, live from their GPS vendor
 * via the run.gpx proxy (`/api/gpx/public/shuttles`, already trust-boundary
 * filtered to position + light status).
 *
 * WHY DOM MARKERS AND NOT A SYMBOL LAYER. The first cut used a Mapbox symbol
 * layer, which caps what the art can do: no hover state, no CSS animation, and
 * icons that must be pre-rasterised per livery. The KPH payphone and the Deuce
 * fleet both use `mapboxgl.Marker` for exactly this reason, and the payphone's
 * own comment — "the rarest thing on the map, so it is allowed to be the
 * loudest" — is the standard being matched here: a bob, a livery-tinted glow,
 * growth on hover, and a pop when fresh telemetry lands.
 *
 * Nothing is simulated. Unlike the Deuce next door these are real vehicles, so
 * markers move to the reported fix rather than being interpolated along a
 * schedule. Stale buses stay on the map asleep instead of vanishing: the feed is
 * quiet most of the year, and hiding them would empty the layer and make the egg
 * behind it unfindable.
 */
export class ShuttleLayer {
    map: mapboxgl.Map;
    private popup = new mapboxgl.Popup({
        closeButton: true,
        offset: 40,
        maxWidth: '460px',
        className: 'dc34-shuttle-popup',
    });
    private timer: ReturnType<typeof setInterval> | null = null;
    private buses = new Map<string, Bus>();
    private visible = false;

    constructor(map: mapboxgl.Map) {
        this.map = map;
    }

    private makeBus(id: string, seq: number): Bus {
        const el = document.createElement('div');
        el.className = 'dc34-shuttle';
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' });
        const bus: Bus = { marker, el, sig: '', lastFixMs: null };

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const d = this.dataFor(el, seq);
            if (!d) return;
            this.popup
                .setLngLat(marker.getLngLat())
                .setHTML(ticketHtml(d))
                .addTo(this.map);
            // The ticket is raw HTML, not a component, so the stub's hand-off to
            // the CMS-editable egg modal is wired after it mounts.
            this.popup
                .getElement()
                ?.querySelector<HTMLButtonElement>('[data-dc34-shuttle-egg]')
                ?.addEventListener('click', () => {
                    this.popup.remove();
                    void openEggModal(this.map, SHUTTLE_EGG_ID, marker.getLngLat().toArray() as [number, number]);
                });
        });
        return bus;
    }

    /** Read back the values stashed on the element at render time. */
    private dataFor(el: HTMLDivElement, seq: number) {
        const raw = el.dataset.bus;
        if (!raw) return null;
        try {
            const p = JSON.parse(raw) as {
                name: string; color: string; colorHex: string;
                kmh: number; hdg: number; lastFixMs: number | null;
            };
            return {
                ...p,
                seq,
                face: faceFor(p.kmh, p.lastFixMs, Date.now()),
            };
        } catch {
            return null;
        }
    }

    private render(bus: Bus, p: Record<string, unknown>, seq: number) {
        const name = typeof p.name === 'string' ? p.name : 'Shuttle';
        const hex = typeof p.colorHex === 'string' ? p.colorHex : FALLBACK_HEX;
        const color = typeof p.color === 'string' ? p.color : 'unknown';
        const kmh = typeof p.kmh === 'number' ? p.kmh : 0;
        const hdg = typeof p.hdg === 'number' ? p.hdg : 0;
        const lastFixMs = typeof p.lastFixMs === 'number' ? p.lastFixMs : null;
        const face = faceFor(kmh, lastFixMs, Date.now());

        bus.el.dataset.bus = JSON.stringify({ name, color, colorHex: hex, kmh, hdg, lastFixMs });
        bus.el.title = `${name} — BSides Las Vegas shuttle`;
        // Livery drives the glow, so a pink and an orange bus are distinguishable
        // even when they overlap in the same lot.
        bus.el.style.setProperty('--dc34-shuttle-glow', hex);
        bus.el.classList.toggle('dc34-shuttle-left', facesLeft(hdg));
        bus.el.classList.toggle('dc34-shuttle-asleep', face === 'sleeping' || face === 'nofix');

        // Only touch innerHTML when the art actually changes — a 45s repaint
        // would otherwise restart the bob animation on every poll.
        const sig = `${hex}|${face}|${name}`;
        if (sig !== bus.sig) {
            bus.sig = sig;
            bus.el.innerHTML =
                `<div class="dc34-shuttle-art">${shuttleSvg(hex, face)}</div>` +
                `<div class="dc34-shuttle-label">${name.replace(/[<&>]/g, '')}</div>`;
        }

        // A genuinely new fix pops the marker. This is the only moment the layer
        // has anything new to say, so it is worth one beat of motion.
        if (lastFixMs !== null && bus.lastFixMs !== null && lastFixMs !== bus.lastFixMs) {
            bus.el.classList.remove('dc34-shuttle-hit');
            void bus.el.offsetWidth; // reflow so the animation can restart
            bus.el.classList.add('dc34-shuttle-hit');
        }
        bus.lastFixMs = lastFixMs;
    }

    private async refresh() {
        try {
            const res = await fetch(shuttleUrl(), { credentials: 'omit' });
            if (!res.ok) return;
            const fc = (await res.json()) as GeoJSON.FeatureCollection;
            const seen = new Set<string>();
            let seq = 0;

            for (const f of fc.features ?? []) {
                seq += 1;
                const p = (f.properties ?? {}) as Record<string, unknown>;
                const id = typeof p.id === 'string' ? p.id : `bus-${seq}`;
                seen.add(id);

                // ⚠️ POSITION BEFORE MOUNT. `Marker.addTo()` immediately projects
                // its lngLat, so adding a marker that has never been positioned
                // throws "Cannot read properties of undefined (reading 'lng')".
                // That throw lands in the catch below and killed the whole
                // refresh — the layer switched on and silently drew nothing.
                const c = (f.geometry as GeoJSON.Point)?.coordinates as [number, number] | undefined;
                let bus = this.buses.get(id);
                if (!bus) {
                    bus = this.makeBus(id, seq);
                    this.buses.set(id, bus);
                    bus.marker.setLngLat(c ?? TUSCANY_ANCHOR);
                    if (this.visible) bus.marker.addTo(this.map);
                } else if (c) {
                    bus.marker.setLngLat(c);
                }
                this.render(bus, p, seq);
            }
            // A bus that dropped out of the feed entirely comes off the map.
            for (const [id, bus] of this.buses) {
                if (!seen.has(id)) { bus.marker.remove(); this.buses.delete(id); }
            }
            shuttleState.update((s) => ({ ...s, available: true, count: this.buses.size }));
        } catch (error) {
            // Keep the last frame, but SAY SO. A bare `catch {}` here turned a
            // one-line marker-ordering bug into an invisible failure that shipped
            // to production: the layer toggled on, drew nothing, and reported
            // nothing. Never make this silent again.
            console.error('shuttle layer refresh failed:', error);
        }
    }

    async setVisible(visible: boolean) {
        this.visible = visible;
        shuttleState.update((s) => ({ ...s, visible }));
        if (visible) {
            for (const bus of this.buses.values()) bus.marker.addTo(this.map);
            await this.refresh();
            if (!this.timer) this.timer = setInterval(() => this.refresh(), POLL_MS);
        } else {
            this.popup.remove();
            for (const bus of this.buses.values()) bus.marker.remove();
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
        }
    }

    remove() {
        this.popup.remove();
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        for (const bus of this.buses.values()) bus.marker.remove();
        this.buses.clear();
        this.visible = false;
    }
}
