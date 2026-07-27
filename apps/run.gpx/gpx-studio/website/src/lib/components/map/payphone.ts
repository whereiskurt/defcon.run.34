import mapboxgl from 'mapbox-gl';
import { openEggModal } from './egg-modal';

/**
 * The PayPhone — a CTF clue beacon at The Strat.
 *
 * Sibling of The Spot (the-spot.ts) and the PublicUs coffee beacon: a flat,
 * always-on DOM marker — a big ☎️ that gently bobs with amber radiating rays,
 * over a little "PayPhone" sign. Clicking it opens the dc34-payphone modal
 * (public eggs endpoint, CMS-overridable) whose message is the clue:
 * "Call me! 725-404-3234". No unlock mechanic, no covert CTF award — the
 * reward is on the other end of the line.
 */

/** The Strat, 2000 Las Vegas Blvd S — Nominatim pin (geocoded, not eyeballed). */
const PAYPHONE_LOCATION: [number, number] = [-115.1561024, 36.1476992];
const EGG_ID = 'dc34-payphone';
const STYLE_ID = 'dc34-payphone-beacon-style';

/** Inject the beacon CSS once (keyframes can't be inlined on the element). */
function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.dc34-payphone-beacon{display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;line-height:1;pointer-events:auto;}
/* same emoji sizing family as the spot/coffee beacons; rays/glow/bob em-relative */
.dc34-payphone-phone{position:relative;font-size:32px;animation:dc34phonebob 2s ease-in-out infinite;filter:drop-shadow(0 0 .2em rgba(255,196,0,.95)) drop-shadow(0 .06em .12em rgba(0,0,0,.5));}
/* radiating "ringing" rays behind the handset — bell-system amber */
.dc34-payphone-phone::before{content:"";position:absolute;inset:-.34em;z-index:-1;border-radius:50%;
  background:repeating-conic-gradient(from 0deg, rgba(242,169,0,.7) 0 4deg, transparent 4deg 30deg);
  -webkit-mask:radial-gradient(closest-side, transparent 50%, #000 60%, transparent 88%);
          mask:radial-gradient(closest-side, transparent 50%, #000 60%, transparent 88%);
  animation:dc34phonespin 5s linear infinite, dc34phoneglow 1.6s ease-in-out infinite;}
.dc34-payphone-label{margin-top:4px;background:rgba(28,24,12,.65);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  color:#fff3d6;border:1px solid rgba(242,169,0,.85);border-radius:9px;padding:2px 8px;text-align:center;
  font:600 10px/1.25 system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.4);}
@keyframes dc34phonebob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.08em)}}
@keyframes dc34phonespin{to{transform:rotate(360deg)}}
@keyframes dc34phoneglow{0%,100%{opacity:.35}50%{opacity:.95}}
@media (prefers-reduced-motion: reduce){
  .dc34-payphone-phone,.dc34-payphone-phone::before{animation:none}
}`;
    document.head.appendChild(s);
}

export class PayPhone {
    map: mapboxgl.Map;
    private marker: mapboxgl.Marker | null = null;
    private el: HTMLElement | null = null;

    /** The Strat coordinates. */
    static readonly location = PAYPHONE_LOCATION;

    constructor(map: mapboxgl.Map) {
        this.map = map;
        this.build();
    }

    private build() {
        ensureStyle();
        const el = document.createElement('div');
        el.className = 'dc34-payphone-beacon';
        el.title = 'PayPhone — The Strat';
        el.innerHTML =
            '<div class="dc34-payphone-phone">☎️</div>' +
            '<div class="dc34-payphone-label">PayPhone<br>The Strat</div>';
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            void openEggModal(this.map, EGG_ID, PAYPHONE_LOCATION);
        });
        this.el = el;
        // anchor:'bottom' -> the sign's tip sits on the phone booth.
        this.marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat(PAYPHONE_LOCATION)
            .addTo(this.map);
    }

    remove() {
        this.marker?.remove();
        this.marker = null;
        this.el = null;
    }
}
