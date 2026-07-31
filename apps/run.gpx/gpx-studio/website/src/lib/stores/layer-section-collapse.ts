import { writable } from 'svelte/store';

/**
 * Persisted expand/collapse state for every collapsible section in the Map Layers
 * dialog (Kurt 2026-07-30: "I've hidden all the dc runs and collapsed it, but it
 * always opens expanded").
 *
 * WHY A STORE AND NOT `$state` IN THE SECTION'S OWN COMPONENT — the shared DialogShell
 * renders inside a bits-ui `Dialog.Portal` with no forceMount, so closing the dialog
 * removes its ENTIRE subtree from the DOM. Every rune declared by a component rendered
 * inside that subtree is destroyed on close and re-initialised to its literal default on
 * reopen. Anything that must survive a close has to live outside the dialog; backing it
 * with localStorage additionally carries it across a page reload, which is the whole
 * point — the user's folded-away sections stay folded tomorrow too.
 *
 * KEYS ARE STABLE IDS, never an array index and never the display label: route-group and
 * con-day labels are CMS/data driven and change under us, and a re-order would otherwise
 * shuffle one section's state onto another. Shape:
 *
 *   basemap · overlays · checkins · heatmap · myconruns · community
 *   group:<folderId>     one public route group
 *   conday:<conDay>      one day of "My DEF CON Runs"
 *
 * An id absent from the map means "never touched" — each call site supplies its own
 * default, so the first-visit look of the dialog is unchanged from before this store.
 */
const KEY = 'dc34LayerSectionCollapse';

/** Stable ids for the fixed (non data-driven) sections. */
export const SECTION = {
    basemap: 'basemap',
    overlays: 'overlays',
    checkins: 'checkins',
    heatmap: 'heatmap',
    myConRuns: 'myconruns',
    community: 'community',
} as const;

/** Stable id for one public route group, keyed by its folder id. */
export function groupSection(folderId: string): string {
    return `group:${folderId}`;
}

/** Stable id for one con-day sub-section of My DEF CON Runs. */
export function conDaySection(conDay: string): string {
    return `conday:${conDay}`;
}

function initial(): Record<string, boolean> {
    if (typeof localStorage === 'undefined') return {};
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        // Booleans only: a hand-edited or half-written value must degrade to the
        // built-in defaults rather than feeding junk into the `collapsed` prop.
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'boolean') out[k] = v;
        }
        return out;
    } catch {
        return {};
    }
}

export const layerSectionCollapse = writable<Record<string, boolean>>(initial());

layerSectionCollapse.subscribe((v) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
        // Private mode / quota. Collapse state is a nicety; never break the dialog for it.
    }
});

/**
 * Write one section's collapse state (and persist it). Reads go through the store
 * itself (`$layerSectionCollapse[id] ?? <that section's default>`) so the markup stays
 * reactive; each call site owns its own default, which is why there is no read helper.
 */
export function setSectionCollapsed(id: string, collapsed: boolean): void {
    layerSectionCollapse.update((m) => (m[id] === collapsed ? m : { ...m, [id]: collapsed }));
}
