import mapboxgl from 'mapbox-gl';
import { openEggModal } from './egg-modal';

/**
 * The PayPhone — a CTF clue beacon at The Strat.
 *
 * Sibling of The Spot (the-spot.ts) and the PublicUs coffee beacon: a flat,
 * always-on DOM marker — "The Booth", an SVG Bell-blue payphone (keypad,
 * handset, coin slot) with a hand-scrawled note taped to the faceplate:
 * "CALL ME! 725-404-3234". It bobs with amber "ringing" rays over a monospace
 * "☎ 725-404-3234" pill so the number reads at every zoom. Clicking opens the
 * dc34-payphone modal (public eggs endpoint, CMS-overridable). No unlock
 * mechanic, no covert CTF award — the reward is on the other end of the line.
 * The art is an original 2600-zine homage (no licensed photos in the bundle).
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
/* "The Booth" SVG box (48x78); bob + amber glow, rays in px around the art */
.dc34-payphone-phone{position:relative;width:48px;height:78px;animation:dc34phonebob 2s ease-in-out infinite;filter:drop-shadow(0 0 6px rgba(255,196,0,.85)) drop-shadow(0 2px 4px rgba(0,0,0,.5));}
.dc34-payphone-phone svg{display:block;width:100%;height:100%;}
/* radiating "ringing" rays behind the booth — bell-system amber */
.dc34-payphone-phone::before{content:"";position:absolute;inset:-12px;z-index:-1;border-radius:50%;
  background:repeating-conic-gradient(from 0deg, rgba(242,169,0,.7) 0 4deg, transparent 4deg 30deg);
  -webkit-mask:radial-gradient(closest-side, transparent 50%, #000 60%, transparent 88%);
          mask:radial-gradient(closest-side, transparent 50%, #000 60%, transparent 88%);
  animation:dc34phonespin 5s linear infinite, dc34phoneglow 1.6s ease-in-out infinite;}
.dc34-payphone-label{margin-top:4px;background:rgba(28,24,12,.65);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  color:#fff3d6;border:1px solid rgba(242,169,0,.85);border-radius:9px;padding:2px 8px;text-align:center;
  font:600 10px/1.25 'Courier New',monospace;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.4);}
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
            '<div class="dc34-payphone-phone">' +
            '<svg viewBox="0 0 60 98" xmlns="http://www.w3.org/2000/svg">' +
            // Bell-blue enclosure + dark inset + silver faceplate
            '<rect x="4" y="2" width="52" height="84" rx="6" fill="#1e3a5f" stroke="#4a6f9e" stroke-width="1.5"/>' +
            '<rect x="9" y="7" width="42" height="74" rx="3" fill="#0f2440"/>' +
            '<rect x="12" y="10" width="36" height="68" rx="2" fill="#c9ced6"/>' +
            // handset resting on its hooks
            '<rect x="14" y="14" width="8" height="34" rx="4" fill="#22262e"/>' +
            '<rect x="12.5" y="12.5" width="11" height="8" rx="4" fill="#22262e"/>' +
            '<rect x="12.5" y="41.5" width="11" height="8" rx="4" fill="#22262e"/>' +
            // keypad
            '<g fill="#3a4150">' +
            '<rect x="28" y="16" width="6" height="5" rx="1"/><rect x="35.5" y="16" width="6" height="5" rx="1"/>' +
            '<rect x="28" y="23" width="6" height="5" rx="1"/><rect x="35.5" y="23" width="6" height="5" rx="1"/>' +
            '<rect x="28" y="30" width="6" height="5" rx="1"/><rect x="35.5" y="30" width="6" height="5" rx="1"/>' +
            '<rect x="28" y="37" width="6" height="5" rx="1"/><rect x="35.5" y="37" width="6" height="5" rx="1"/>' +
            '</g>' +
            // coin slot + coin return
            '<rect x="40" y="47" width="6" height="2.5" rx="1" fill="#5a6170"/>' +
            '<rect x="27" y="70" width="10" height="4" rx="1" fill="#3a4150"/>' +
            // the taped note — the clue itself
            '<g transform="rotate(-5 30 60)">' +
            '<rect x="13" y="53" width="34" height="15" rx="1.5" fill="#fdf6e3" stroke="#d9cba3" stroke-width="0.6"/>' +
            '<rect x="24" y="51" width="12" height="4" fill="rgba(200,200,190,.6)"/>' +
            '<text x="30" y="59" text-anchor="middle" font-family="Marker Felt, Comic Sans MS, cursive" font-size="4.6" fill="#c1121f">CALL ME!</text>' +
            '<text x="30" y="65" text-anchor="middle" font-family="Courier New, monospace" font-weight="bold" font-size="4.8" fill="#1a1a1a">725-404-3234</text>' +
            '</g>' +
            // legs
            '<rect x="16" y="86" width="4" height="10" fill="#31445e"/>' +
            '<rect x="40" y="86" width="4" height="10" fill="#31445e"/>' +
            '</svg>' +
            '</div>' +
            '<div class="dc34-payphone-label">☎ 725-404-3234</div>';
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
