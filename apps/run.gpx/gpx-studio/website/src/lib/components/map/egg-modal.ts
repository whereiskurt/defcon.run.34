import mapboxgl from 'mapbox-gl';

/**
 * Shared route-style modal for the map easter eggs (rainbow arches + coffee cup).
 *
 * Content comes from the public, unauthenticated gpx endpoint
 * `/api/gpx/public/eggs` — hardcoded defaults that ship without a run.cms deploy,
 * with CMS rows overriding title/description/cover later (see the endpoint). The
 * popup markup mirrors the public routes popup (public-overlays `popupHtml`): a
 * dark card with a coloured left tab, eyebrow, title, address, cover image,
 * rich-text body, and links.
 *
 * Every dynamic value is escaped; `descriptionHtml` is the only trusted-HTML slot
 * (server-rendered from a whitelist, or a hardcoded default string).
 */

export type EggLink = { label: string; url: string };

export type EggModal = {
    id: string;
    eyebrow: string;
    title: string;
    descriptionHtml: string;
    address?: string;
    coverImageUrl?: string;
    coverImageDisplayUrl?: string;
    links?: EggLink[];
    accent?: string;
};

// The studio is served under the region basePath (e.g. /use1/studio/app), but the
// API lives at /use1/api/... — a root-absolute '/api/...' drops the region and
// 404s. Derive the prefix as everything before '/studio' (mirrors public-overlays).
function regionPrefix(): string {
    if (typeof location === 'undefined') return '';
    const i = location.pathname.indexOf('/studio');
    return i > 0 ? location.pathname.slice(0, i) : '';
}

const ENDPOINT = `${regionPrefix()}/api/gpx/public/eggs`;
const DEFAULT_ACCENT = '#00e5ff';

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
    );
}

// Module cache + in-flight dedupe so N clicks share one fetch.
let cache: Map<string, EggModal> | null = null;
let inflight: Promise<Map<string, EggModal>> | null = null;

async function loadEggs(): Promise<Map<string, EggModal>> {
    if (cache) return cache;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const res = await fetch(ENDPOINT, { credentials: 'omit' });
            if (!res.ok) return new Map<string, EggModal>();
            const body = (await res.json()) as { eggs?: EggModal[] };
            const m = new Map((body.eggs ?? []).map((e) => [e.id, e]));
            cache = m; // only cache a real answer
            return m;
        } catch {
            return new Map<string, EggModal>(); // endpoint down → no modal, studio unaffected
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

function eggPopupHtml(egg: EggModal): string {
    const accent = egg.accent || DEFAULT_ACCENT;

    const address = egg.address
        ? `<div style="font-size:12px;opacity:.7;margin-top:6px">📍 ${escapeHtml(egg.address)}</div>`
        : '';

    // Cover image — click opens the full-size original in a new tab.
    const cover = egg.coverImageDisplayUrl
        ? `<a href="${escapeHtml(egg.coverImageUrl || egg.coverImageDisplayUrl)}" target="_blank" rel="noopener noreferrer">
              <img src="${escapeHtml(egg.coverImageDisplayUrl)}" alt="${escapeHtml(egg.title)}"
                   loading="lazy" style="width:100%;border-radius:6px;margin-top:8px;display:block" /></a>`
        : '';

    // Rich-text body — trusted HTML (server-rendered whitelist / hardcoded default).
    const desc = egg.descriptionHtml
        ? `<div class="dc34-egg-desc" style="margin-top:8px;font-size:12px;line-height:1.45;opacity:.9">${egg.descriptionHtml}</div>`
        : '';

    const links =
        egg.links && egg.links.length
            ? `<div style="margin-top:8px">${egg.links
                  .map(
                      (l) =>
                          `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer"
                              style="display:inline-block;margin-right:14px;font-size:12px;font-weight:600;color:${accent};text-decoration:none">↗ ${escapeHtml(l.label)}</a>`
                  )
                  .join('')}</div>`
            : '';

    return `
        <div style="min-width:200px;max-width:280px;padding:10px 12px;border-left:4px solid ${accent};
                    font-family:system-ui,sans-serif;color:#e4e4ef">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.55">${escapeHtml(egg.eyebrow)}</div>
            <div style="font-size:15px;font-weight:600;margin-top:2px">${escapeHtml(egg.title)}</div>
            ${address}
            ${cover}
            ${desc}
            ${links}
        </div>`;
}

// One popup per map (GC'd with the map).
const popups = new WeakMap<mapboxgl.Map, mapboxgl.Popup>();
function popupFor(map: mapboxgl.Map): mapboxgl.Popup {
    let p = popups.get(map);
    if (!p) {
        p = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: '280px',
            offset: 16,
            className: 'dc34-egg-popup'
        });
        popups.set(map, p);
    }
    return p;
}

/**
 * Open the route-style modal for `id` at `lngLat`. No-op if the endpoint has no
 * entry for that id (e.g. endpoint unreachable) so a click can never throw.
 */
export async function openEggModal(
    map: mapboxgl.Map,
    id: string,
    lngLat: mapboxgl.LngLatLike
): Promise<void> {
    const egg = (await loadEggs()).get(id);
    if (!egg) return;
    popupFor(map).setLngLat(lngLat).setHTML(eggPopupHtml(egg)).addTo(map);
}
