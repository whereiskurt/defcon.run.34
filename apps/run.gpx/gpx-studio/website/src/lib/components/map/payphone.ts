import mapboxgl from 'mapbox-gl';
import { openEggModal } from './egg-modal';

/**
 * The PayPhones — CTF clue beacons at ReBAR, the Las Vegas sign, the Rio, and
 * the Double Down Saloon.
 *
 * Siblings of The Spot (the-spot.ts) and the PublicUs coffee beacon: flat,
 * always-on DOM markers — "The Booth", an SVG Bell-blue payphone (keypad,
 * handset, coin slot) with a hand-scrawled note taped to the faceplate:
 * "CALL ME! <number>". Each bobs with amber "ringing" rays over a monospace
 * "☎ <number>" pill so the number reads at every zoom. Clicking opens that
 * phone's egg modal (public eggs endpoint, CMS-overridable). For the four
 * public booths there is no covert CTF award — the reward is on the other end
 * of the line. The art is an original 2600-zine homage (no licensed photos in
 * the bundle).
 *
 * A FIFTH booth is secret: the all-red KPH phone in the middle of the LVCC. It
 * does not answer to the public 2600 / #-#-# reveal — only `kph` (typed or
 * searched) lights it up, and that reveal is what fires the 250-point
 * `kph-phone` covert award. See stores/kph.ts and kph-egg.ts.
 */

type PhoneSpec = {
    eggId: string;
    /** Nominatim pin (geocoded, not eyeballed). */
    location: [number, number];
    number: string;
    place: string;
    /** Booth colourway. Default Bell blue; 'red' is the secret KPH phone. */
    palette?: 'bell' | 'red';
    /**
     * Secret booths ignore the public reveal (2600 / #-#-#) and are driven by
     * their own store instead — see `setSecretVisible`.
     */
    secret?: boolean;
};

const PAYPHONES: PhoneSpec[] = [
    {
        eggId: 'dc34-payphone',
        location: [-115.1535043, 36.1565826], // ReBAR, 1225 S Main St (moved from The Strat)
        number: '725-404-3234',
        place: 'ReBAR',
    },
    {
        eggId: 'dc34-payphone-sign',
        location: [-115.1727735, 36.0820593], // Welcome to Fabulous Las Vegas Sign
        number: '725-404-3283',
        place: 'Las Vegas Sign',
    },
    {
        eggId: 'dc34-payphone-rio',
        location: [-115.1882831, 36.1175311], // Rio, 3700 W Flamingo Rd
        number: '725-404-8283',
        place: 'The Rio',
    },
    {
        eggId: 'dc34-payphone-doubledown',
        location: [-115.1503087, 36.1055201], // Double Down Saloon, 4640 Paradise Rd
        number: '1-855-916-4636',
        place: 'Double Down Saloon',
    },
    {
        // The secret one. Stays dark through the public 2600 / #-#-# reveal;
        // only `kph` (typed or searched) lights it up, and that reveal is what
        // fires the kph-phone covert award. See stores/kph.ts + kph-egg.ts.
        eggId: 'dc34-payphone-kph',
        location: [-115.1512, 36.1316], // Las Vegas Convention Center (same pin the arches use)
        number: '1-945-369-0089',
        place: 'LVCC',
        palette: 'red',
        secret: true,
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
/* the secret KPH booth — same art, all red, and cranked: a three-layer crimson
   halo that breathes, hotter/denser rays, and a glowing pill. It is the rarest
   thing on the map, so it is allowed to be the loudest. */
.dc34-payphone-phone.dc34-payphone-red{
  animation:dc34phonebob 2s ease-in-out infinite, dc34redpulse 1.9s ease-in-out infinite;
  filter:drop-shadow(0 0 5px rgba(255,70,90,.95)) drop-shadow(0 0 16px rgba(225,29,72,.75)) drop-shadow(0 2px 4px rgba(0,0,0,.55));}
.dc34-payphone-phone.dc34-payphone-red::before{inset:-16px;
  background:repeating-conic-gradient(from 0deg, rgba(255,70,90,.9) 0 5deg, transparent 5deg 26deg);
  animation:dc34phonespin 3.6s linear infinite, dc34phoneglow 1.2s ease-in-out infinite;}
.dc34-payphone-label.dc34-payphone-label-red{background:rgba(40,8,14,.78);color:#ffe4e6;
  border-color:rgba(255,70,90,.95);box-shadow:0 0 10px rgba(225,29,72,.65),0 2px 10px rgba(0,0,0,.5);
  text-shadow:0 0 6px rgba(255,120,140,.8);}
@keyframes dc34phonebob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.08em)}}
@keyframes dc34phonespin{to{transform:rotate(360deg)}}
@keyframes dc34phoneglow{0%,100%{opacity:.35}50%{opacity:.95}}
@keyframes dc34redpulse{
  0%,100%{filter:drop-shadow(0 0 4px rgba(255,70,90,.8)) drop-shadow(0 0 12px rgba(225,29,72,.5)) drop-shadow(0 2px 4px rgba(0,0,0,.55));}
  50%{filter:drop-shadow(0 0 9px rgba(255,90,110,1)) drop-shadow(0 0 26px rgba(225,29,72,.95)) drop-shadow(0 0 46px rgba(225,29,72,.55)) drop-shadow(0 2px 4px rgba(0,0,0,.55));}}
@media (prefers-reduced-motion: reduce){
  /* the .dc34-payphone-red rules above are more specific, so they must be named
     here too or the booth keeps bobbing and pulsing for reduced-motion users */
  .dc34-payphone-phone,.dc34-payphone-phone::before,
  .dc34-payphone-phone.dc34-payphone-red,.dc34-payphone-phone.dc34-payphone-red::before{animation:none}
}`;
    document.head.appendChild(s);
}

/**
 * Booth colourways. `bell` is the stock Bell-blue enclosure with a silver
 * faceplate; `red` is the secret KPH booth — every panel in the crimson family
 * so it reads as an all-red phone at a glance, with only the taped paper note
 * left light enough to keep the number legible.
 */
const PALETTES = {
    bell: {
        shell: '#1e3a5f',
        shellEdge: '#4a6f9e',
        inset: '#0f2440',
        face: '#c9ced6',
        hardware: '#22262e',
        keys: '#3a4150',
        slot: '#5a6170',
        legs: '#31445e',
        note: '#fdf6e3',
        noteEdge: '#d9cba3',
    },
    red: {
        shell: '#a50f1c',
        shellEdge: '#ff5a66',
        inset: '#4a040a',
        face: '#cf1f2e',
        hardware: '#2b0206',
        keys: '#7d0d16',
        slot: '#ff5a66',
        legs: '#6b0a12',
        note: '#fff1f1',
        noteEdge: '#e8b8b8',
        // `red`-only extras. The bell booth leaves these undefined so its art
        // stays byte-identical to what already shipped.
        gloss: 'rgba(255,255,255,.16)',
        faceEdge: '#ff7b85',
    },
} as const;

/** "The Booth" — the A2 payphone art with the phone's number on the taped note. */
function boothSvg(number: string, palette: 'bell' | 'red' = 'bell'): string {
    // The taped note is 34 units wide and Courier advances ~0.6em, so the fit
    // is ~12 chars at 4.8. Toll-free (13) and 1+NPA (14, e.g. 1-945-369-0089)
    // each need a step down or the last digit rides over the note's edge.
    const noteFs = number.length > 13 ? 3.8 : number.length > 12 ? 4.1 : 4.8;
    const p: {
        [K in keyof (typeof PALETTES)['red']]: string;
    } = { gloss: '', faceEdge: '', ...PALETTES[palette] };
    return (
        '<svg viewBox="0 0 60 98" xmlns="http://www.w3.org/2000/svg">' +
        // enclosure + dark inset + faceplate
        `<rect x="4" y="2" width="52" height="84" rx="6" fill="${p.shell}" stroke="${p.shellEdge}" stroke-width="1.5"/>` +
        `<rect x="9" y="7" width="42" height="74" rx="3" fill="${p.inset}"/>` +
        `<rect x="12" y="10" width="36" height="68" rx="2" fill="${p.face}"${
            p.faceEdge ? ` stroke="${p.faceEdge}" stroke-width="0.8"` : ''
        }/>` +
        // red-only: a diagonal sheen across the shell so it reads as lacquered
        // rather than flat, and a hot rim light down the left edge.
        (p.gloss
            ? `<path d="M6 6 L28 4 L12 44 L6 40 Z" fill="${p.gloss}"/>` +
              `<rect x="5.2" y="4" width="1.6" height="80" rx="0.8" fill="${p.gloss}"/>`
            : '') +
        // handset resting on its hooks
        `<rect x="14" y="14" width="8" height="34" rx="4" fill="${p.hardware}"/>` +
        `<rect x="12.5" y="12.5" width="11" height="8" rx="4" fill="${p.hardware}"/>` +
        `<rect x="12.5" y="41.5" width="11" height="8" rx="4" fill="${p.hardware}"/>` +
        // keypad
        `<g fill="${p.keys}">` +
        '<rect x="28" y="16" width="6" height="5" rx="1"/><rect x="35.5" y="16" width="6" height="5" rx="1"/>' +
        '<rect x="28" y="23" width="6" height="5" rx="1"/><rect x="35.5" y="23" width="6" height="5" rx="1"/>' +
        '<rect x="28" y="30" width="6" height="5" rx="1"/><rect x="35.5" y="30" width="6" height="5" rx="1"/>' +
        '<rect x="28" y="37" width="6" height="5" rx="1"/><rect x="35.5" y="37" width="6" height="5" rx="1"/>' +
        '</g>' +
        // coin slot + coin return
        `<rect x="40" y="47" width="6" height="2.5" rx="1" fill="${p.slot}"/>` +
        `<rect x="27" y="70" width="10" height="4" rx="1" fill="${p.keys}"/>` +
        // the taped note — the clue itself
        '<g transform="rotate(-5 30 60)">' +
        `<rect x="13" y="53" width="34" height="15" rx="1.5" fill="${p.note}" stroke="${p.noteEdge}" stroke-width="0.6"/>` +
        '<rect x="24" y="51" width="12" height="4" fill="rgba(200,200,190,.6)"/>' +
        '<text x="30" y="59" text-anchor="middle" font-family="Marker Felt, Comic Sans MS, cursive" font-size="4.6" fill="#c1121f">CALL ME!</text>' +
        `<text x="30" y="65" text-anchor="middle" font-family="Courier New, monospace" font-weight="bold" font-size="${noteFs}" fill="#1a1a1a">${number}</text>` +
        '</g>' +
        // legs
        `<rect x="16" y="86" width="4" height="10" fill="${p.legs}"/>` +
        `<rect x="40" y="86" width="4" height="10" fill="${p.legs}"/>` +
        '</svg>'
    );
}

export class PayPhone {
    map: mapboxgl.Map;
    private markers: mapboxgl.Marker[] = [];
    private secretMarkers: mapboxgl.Marker[] = [];
    private built = false;
    private secretBuilt = false;

    /** The PUBLIC payphone locations (ReBAR, LV Sign, Rio, Double Down). */
    static readonly locations = PAYPHONES.filter((p) => !p.secret).map((p) => p.location);

    constructor(map: mapboxgl.Map) {
        this.map = map;
        // Hidden by default — booths build on the first reveal (search
        // 2600/phone/phones/1800 or press #-#-#; see stores/payphone.ts).
    }

    /** The four public booths (payphonesShown store). */
    setVisible(visible: boolean) {
        if (visible && !this.built) {
            this.build(false, this.markers);
            this.built = true;
        }
        for (const m of this.markers) {
            m.getElement().style.display = visible ? '' : 'none';
        }
    }

    /**
     * The secret KPH booth (kphShown store). Built lazily and SEPARATELY from
     * the public group so revealing the four public booths never puts the
     * secret one in the DOM.
     */
    setSecretVisible(visible: boolean) {
        if (visible && !this.secretBuilt) {
            this.build(true, this.secretMarkers);
            this.secretBuilt = true;
        }
        for (const m of this.secretMarkers) {
            m.getElement().style.display = visible ? '' : 'none';
        }
    }

    private build(secret: boolean, into: mapboxgl.Marker[]) {
        ensureStyle();
        for (const phone of PAYPHONES.filter((p) => !!p.secret === secret)) {
            const red = phone.palette === 'red';
            const el = document.createElement('div');
            el.className = 'dc34-payphone-beacon';
            el.title = `PayPhone — ${phone.place}`;
            el.innerHTML =
                `<div class="dc34-payphone-phone${red ? ' dc34-payphone-red' : ''}">` +
                `${boothSvg(phone.number, phone.palette ?? 'bell')}</div>` +
                `<div class="dc34-payphone-label${red ? ' dc34-payphone-label-red' : ''}">` +
                `☎ ${phone.number}</div>`;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                void openEggModal(this.map, phone.eggId, phone.location);
            });
            // anchor:'bottom' -> the sign's tip sits on the phone booth.
            into.push(
                new mapboxgl.Marker({ element: el, anchor: 'bottom' })
                    .setLngLat(phone.location)
                    .addTo(this.map)
            );
        }
    }

    remove() {
        for (const m of this.markers) m.remove();
        for (const m of this.secretMarkers) m.remove();
        this.markers = [];
        this.secretMarkers = [];
        this.built = false;
        this.secretBuilt = false;
    }
}
