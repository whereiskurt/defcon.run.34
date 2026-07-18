import mapboxgl from 'mapbox-gl';
import { fireCoffeeEgg } from './coffee-egg';
import { openEggModal } from './egg-modal';

/**
 * The PublicUs coffee beacon — the "OH, that's where KPH gets his coffee!" marker.
 *
 * Replaces the old 3D fill-extrusion cup (which read as a grey monolith and never
 * looked like a mug). This is a flat, always-on DOM marker: a big ☕ that gently
 * bobs and glows with radiating "aha" sparkle rays, over a little "KPH's coffee"
 * sign. Always faces the viewer, always legible, on by default — no tilt/search
 * needed. Clicking it opens the PublicUs modal and fires the covert coffee-egg CTF.
 */

/** PublicUs coffee, 1126 Fremont St, Las Vegas (Fremont East). Coordinates from
 * the same geocoder the studio search uses (Nominatim) so the beacon sits exactly
 * where searching "PublicUs" drops its pin. */
const COFFEE_LOCATION: [number, number] = [-115.132972, 36.165783];
const EGG_ID = 'dc34-coffee';
const STYLE_ID = 'dc34-coffee-beacon-style';

/** Inject the beacon CSS once (keyframes can't be inlined on the element). */
function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.dc34-coffee-beacon{display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;line-height:1;pointer-events:auto;}
/* 3× emoji (Kurt). Sparkle/glow/bob sizes are em-relative so they scale with it. */
.dc34-coffee-cup{position:relative;font-size:102px;animation:dc34cupbob 2.4s ease-in-out infinite;filter:drop-shadow(0 0 .2em rgba(255,193,94,.95)) drop-shadow(0 .06em .12em rgba(0,0,0,.5));}
/* radiating "aha" sparkle rays behind the cup */
.dc34-coffee-cup::before{content:"";position:absolute;inset:-.34em;z-index:-1;border-radius:50%;
  background:repeating-conic-gradient(from 0deg, rgba(255,205,120,.65) 0 4deg, transparent 4deg 30deg);
  -webkit-mask:radial-gradient(closest-side, transparent 50%, #000 60%, transparent 88%);
          mask:radial-gradient(closest-side, transparent 50%, #000 60%, transparent 88%);
  animation:dc34cupspin 7s linear infinite, dc34cupglow 2.4s ease-in-out infinite;}
/* semi-transparent two-line sign (Kurt) */
.dc34-coffee-label{margin-top:6px;background:rgba(20,20,28,.6);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  color:#ffe;border:1px solid rgba(255,193,94,.85);border-radius:12px;padding:3px 12px;text-align:center;
  font:600 12px/1.25 system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.4);}
@keyframes dc34cupbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.08em)}}
@keyframes dc34cupspin{to{transform:rotate(360deg)}}
@keyframes dc34cupglow{0%,100%{opacity:.3}50%{opacity:.9}}
.dc34-coffee-beacon.pop .dc34-coffee-cup{animation:dc34cuppop .6s ease}
@keyframes dc34cuppop{0%{transform:scale(1)}35%{transform:scale(1.55)}100%{transform:scale(1)}}
@media (prefers-reduced-motion: reduce){
  .dc34-coffee-cup,.dc34-coffee-cup::before{animation:none}
}`;
    document.head.appendChild(s);
}

export class CoffeeCup {
    map: mapboxgl.Map;
    private marker: mapboxgl.Marker | null = null;
    private el: HTMLElement | null = null;

    /** PublicUs coordinates (used by "fly to PublicUs" flows if wired). */
    static readonly location = COFFEE_LOCATION;

    constructor(map: mapboxgl.Map) {
        this.map = map;
        this.build();
    }

    private build() {
        ensureStyle();
        const el = document.createElement('div');
        el.className = 'dc34-coffee-beacon';
        el.title = 'PublicUs — where KPH gets his coffee';
        el.innerHTML =
            '<div class="dc34-coffee-cup">☕</div>' +
            '<div class="dc34-coffee-label">PublicUs<br>KPH Coffee</div>';
        // Click the beacon → PublicUs modal + covert CTF award. Stop propagation so
        // the click doesn't also fall through to the map (pan/deselect).
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            void openEggModal(this.map, EGG_ID, COFFEE_LOCATION);
            fireCoffeeEgg();
        });
        this.el = el;
        // anchor:'bottom' → the sign's tip sits on PublicUs, cup + rays hover above.
        this.marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat(COFFEE_LOCATION)
            .addTo(this.map);
    }

    /**
     * Searching "publicus"/"coffee" flips the unlock store; the beacon is always
     * visible, so treat it as a moment to draw the eye with a quick attention pop.
     */
    async setUnlocked(on: boolean) {
        if (!on || !this.el) return;
        this.el.classList.remove('pop');
        void this.el.offsetWidth; // force reflow so the animation can restart
        this.el.classList.add('pop');
    }

    remove() {
        this.marker?.remove();
        this.marker = null;
        this.el = null;
    }
}
