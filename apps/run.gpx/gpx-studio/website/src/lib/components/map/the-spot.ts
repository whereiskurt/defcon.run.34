import mapboxgl from 'mapbox-gl';
import { openEggModal } from './egg-modal';

/**
 * "The Spot" — the DEF CON run rally-point beacon at LVCC West.
 *
 * Sibling of the PublicUs coffee beacon (coffee-cup.ts): a flat, always-on DOM
 * marker — a big 🚨 that gently bobs and pulses with red radiating rays, over a
 * little "The Spot" sign. Always faces the viewer, legible at any zoom.
 * Clicking it opens the rally-point modal (dc34-spot in the public eggs
 * endpoint, CMS-overridable). No unlock mechanic, no CTF — this one is pure
 * wayfinding: it marks where the runs meet at 0600.
 */

/** DC34 rally point at LVCC West — the same OpenStreetMap pin as the
 * run.defcon.run landing card's "Meetup Spot" tile (page.tsx meetupMapUrl). */
const SPOT_LOCATION: [number, number] = [-115.158541, 36.135189];
const EGG_ID = 'dc34-spot';
const STYLE_ID = 'dc34-spot-beacon-style';

/** Inject the beacon CSS once (keyframes can't be inlined on the element). */
function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.dc34-spot-beacon{display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;line-height:1;pointer-events:auto;}
/* same 1.5x emoji sizing as the coffee beacon; rays/glow/bob are em-relative */
.dc34-spot-siren{position:relative;font-size:32px;animation:dc34spotbob 2s ease-in-out infinite;filter:drop-shadow(0 0 .2em rgba(255,60,60,.95)) drop-shadow(0 .06em .12em rgba(0,0,0,.5));}
/* radiating siren rays behind the light — red, a touch faster than coffee's */
.dc34-spot-siren::before{content:"";position:absolute;inset:-.34em;z-index:-1;border-radius:50%;
  background:repeating-conic-gradient(from 0deg, rgba(255,80,80,.7) 0 4deg, transparent 4deg 30deg);
  -webkit-mask:radial-gradient(closest-side, transparent 50%, #000 60%, transparent 88%);
          mask:radial-gradient(closest-side, transparent 50%, #000 60%, transparent 88%);
  animation:dc34spotspin 5s linear infinite, dc34spotglow 1.6s ease-in-out infinite;}
.dc34-spot-label{margin-top:4px;background:rgba(28,16,18,.65);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  color:#ffecec;border:1px solid rgba(255,80,80,.85);border-radius:9px;padding:2px 8px;text-align:center;
  font:600 10px/1.25 system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.4);}
@keyframes dc34spotbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.08em)}}
@keyframes dc34spotspin{to{transform:rotate(360deg)}}
@keyframes dc34spotglow{0%,100%{opacity:.35}50%{opacity:.95}}
@media (prefers-reduced-motion: reduce){
  .dc34-spot-siren,.dc34-spot-siren::before{animation:none}
}`;
    document.head.appendChild(s);
}

export class TheSpot {
    map: mapboxgl.Map;
    private marker: mapboxgl.Marker | null = null;
    private el: HTMLElement | null = null;

    /** Rally-point coordinates (LVCC West). */
    static readonly location = SPOT_LOCATION;

    constructor(map: mapboxgl.Map) {
        this.map = map;
        this.build();
    }

    private build() {
        ensureStyle();
        const el = document.createElement('div');
        el.className = 'dc34-spot-beacon';
        el.title = 'The Spot — DEF CON run rally point, 0600 daily';
        el.innerHTML =
            '<div class="dc34-spot-siren">🚨</div>' +
            '<div class="dc34-spot-label">The Spot<br>LVCC West · 0600</div>';
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            void openEggModal(this.map, EGG_ID, SPOT_LOCATION);
        });
        this.el = el;
        // anchor:'bottom' -> the sign's tip sits on the rally point.
        this.marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat(SPOT_LOCATION)
            .addTo(this.map);
    }

    remove() {
        this.marker?.remove();
        this.marker = null;
        this.el = null;
    }
}
