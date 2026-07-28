import mapboxgl from 'mapbox-gl';
import { openEggModal } from './egg-modal';
import { ghostMode } from '$lib/stores/ghost';

/**
 * The PayPhones — CTF clue beacons at The Strat, the Las Vegas sign, and the Rio.
 *
 * Siblings of The Spot (the-spot.ts) and the PublicUs coffee beacon: flat,
 * always-on DOM markers — "The Booth", an SVG Bell-blue payphone (keypad,
 * handset, coin slot) with a hand-scrawled note taped to the faceplate:
 * "CALL ME! <number>". Each bobs with amber "ringing" rays over a monospace
 * "☎ <number>" pill so the number reads at every zoom. Clicking opens that
 * phone's egg modal (public eggs endpoint, CMS-overridable). No unlock
 * mechanic, no covert CTF award — the reward is on the other end of the line.
 * The art is an original 2600-zine homage (no licensed photos in the bundle).
 */

type PhoneSpec = {
    eggId: string;
    /** Nominatim pin (geocoded, not eyeballed). */
    location: [number, number];
    number: string;
    place: string;
    /** Ghost-mode spray tag over the booth (a clue). Absent = clean phone. */
    graffiti?: { text: string; tone: 'pink' | 'green' };
};

const PAYPHONES: PhoneSpec[] = [
    {
        eggId: 'dc34-payphone',
        location: [-115.1561024, 36.1476992], // The Strat, 2000 Las Vegas Blvd S
        number: '725-404-3234',
        place: 'The Strat',
    },
    {
        eggId: 'dc34-payphone-sign',
        location: [-115.1727735, 36.0820593], // Welcome to Fabulous Las Vegas Sign
        number: '725-404-3283',
        place: 'Las Vegas Sign',
        graffiti: { text: '1337', tone: 'pink' },
    },
    {
        eggId: 'dc34-payphone-rio',
        location: [-115.1882831, 36.1175311], // Rio, 3700 W Flamingo Rd
        number: '725-404-8283',
        place: 'The Rio',
        graffiti: { text: '696969', tone: 'green' },
    },
];

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
/* ghost-mode spray tags — hidden until the beacon root gets .dc34-ghost */
.dc34-payphone-graf{display:none;position:absolute;transform:rotate(-18deg);
  font:900 24px 'Marker Felt','Comic Sans MS',cursive;letter-spacing:2px;pointer-events:none;z-index:2;}
.dc34-payphone-beacon.dc34-ghost .dc34-payphone-graf{display:block;}
.dc34-graf-pink{color:#ff2ec4;text-shadow:0 0 8px rgba(255,46,196,.95),0 0 20px rgba(255,46,196,.6),2px 2px 0 #7a0057;top:14px;left:-20px;}
.dc34-graf-green{color:#39ff14;text-shadow:0 0 8px rgba(57,255,20,.95),0 0 20px rgba(57,255,20,.55),2px 2px 0 #0a5c00;font-size:19px;top:18px;left:-26px;}
@keyframes dc34phonebob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.08em)}}
@keyframes dc34phonespin{to{transform:rotate(360deg)}}
@keyframes dc34phoneglow{0%,100%{opacity:.35}50%{opacity:.95}}
@media (prefers-reduced-motion: reduce){
  .dc34-payphone-phone,.dc34-payphone-phone::before{animation:none}
}`;
    document.head.appendChild(s);
}

/** "The Booth" — the A2 payphone art with the phone's number on the taped note. */
function boothSvg(number: string): string {
    return (
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
        `<text x="30" y="65" text-anchor="middle" font-family="Courier New, monospace" font-weight="bold" font-size="4.8" fill="#1a1a1a">${number}</text>` +
        '</g>' +
        // legs
        '<rect x="16" y="86" width="4" height="10" fill="#31445e"/>' +
        '<rect x="40" y="86" width="4" height="10" fill="#31445e"/>' +
        '</svg>'
    );
}

export class PayPhone {
    map: mapboxgl.Map;
    private markers: mapboxgl.Marker[] = [];
    private els: HTMLElement[] = [];
    private unsubGhost: (() => void) | null = null;

    /** All payphone locations (Strat, LV Sign, Rio). */
    static readonly locations = PAYPHONES.map((p) => p.location);

    constructor(map: mapboxgl.Map) {
        this.map = map;
        this.build();
        // Spray tags are ghost-mode clues: toggle a root class the CSS keys on.
        // Self-subscribed (not via LayerControl) so initial state always syncs.
        this.unsubGhost = ghostMode.subscribe((on) => {
            for (const el of this.els) el.classList.toggle('dc34-ghost', on);
        });
    }

    private build() {
        ensureStyle();
        for (const phone of PAYPHONES) {
            const el = document.createElement('div');
            el.className = 'dc34-payphone-beacon';
            el.title = `PayPhone — ${phone.place}`;
            const graffiti = phone.graffiti
                ? `<div class="dc34-payphone-graf dc34-graf-${phone.graffiti.tone}">${phone.graffiti.text}</div>`
                : '';
            el.innerHTML =
                `<div class="dc34-payphone-phone">${boothSvg(phone.number)}${graffiti}</div>` +
                `<div class="dc34-payphone-label">☎ ${phone.number}</div>`;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                void openEggModal(this.map, phone.eggId, phone.location);
            });
            this.els.push(el);
            // anchor:'bottom' -> the sign's tip sits on the phone booth.
            this.markers.push(
                new mapboxgl.Marker({ element: el, anchor: 'bottom' })
                    .setLngLat(phone.location)
                    .addTo(this.map)
            );
        }
    }

    remove() {
        this.unsubGhost?.();
        this.unsubGhost = null;
        for (const m of this.markers) m.remove();
        this.markers = [];
        this.els = [];
    }
}
