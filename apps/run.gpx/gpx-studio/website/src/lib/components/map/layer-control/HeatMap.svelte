<script lang="ts">
    import { Section, Row } from '$lib/components/dialog-shell/index.js';
    import { heatmapState, relativeStamp, HEAT_PAINT, HEAT_YEARS } from '../heatmap-layer';
    import type { HeatmapLayer, HeatYear, HeatYearState } from '../heatmap-layer';
    import {
        layerSectionCollapse,
        setSectionCollapsed,
        SECTION,
    } from '$lib/stores/layer-section-collapse';

    // NO LOCAL RUNE HOLDS STATE HERE, deliberately: the shared DialogShell portals through
    // a bits-ui `Dialog.Portal` with no forceMount, so closing the dialog destroys this
    // ENTIRE subtree and anything declared locally resets on reopen. Collapse therefore
    // lives in the persisted store, as it does for `PublicOverlays`' groups.
    //
    // AND NO visibility-drives-collapse `$effect` either. The siblings fold themselves when
    // their master goes off, which needs per-entry seeding sentinels so a first sighting is
    // not misread as an ON transition (see PublicOverlays.svelte). Collapse here is
    // manual-only, sidestepping that bug class instead of re-guarding it. Do not "restore
    // parity" with PublicOverlays.

    // Created in LayerControl's map.onLoad, so undefined for the first frame.
    let { layer }: { layer: HeatmapLayer | undefined } = $props();

    // Display order: the live year first. Colours are read from HEAT_PAINT, never
    // re-typed, so a row swatch cannot drift from the line it stands for.
    const ROWS: { year: HeatYear; label: string }[] = [
        { year: 'dc34', label: '🔥 DC34 — live' },
        { year: 'dc33', label: '🔥 DC33 — the classic' },
    ];

    /** Exact local build time, or a word — never a throw (T-71-26). */
    function exact(iso: string | null): string {
        if (!iso) return 'unknown';
        const t = Date.parse(iso);
        return Number.isFinite(t) ? new Date(t).toLocaleString() : 'unknown';
    }

    // A year can be available and still hold nothing to draw — DC34 is exactly that until
    // the first con-day run lands. The row stays visible and stays toggleable (its layer is
    // real, just empty), so the hint has to say WHY the map does not change when it is
    // checked; otherwise a working feature reads as a broken checkbox (WR-07). The
    // "Last built … · N runs · N.N km" prefix is a contract — the ship probe asserts on it.
    function detail(s: HeatYearState): string {
        const built = `Last built ${exact(s.generatedAt)} · ${s.runCount} runs · ${s.totalKm.toFixed(1)} km`;
        return s.runCount === 0
            ? `${built} · no runs yet — this layer fills in during the con`
            : built;
    }

    // Only years with an artifact get a row; LayerControl mounts the whole section
    // under the same availability guard.
    const shown = $derived(ROWS.filter((r) => $heatmapState[r.year].available));
    const allOn = $derived(shown.length > 0 && shown.every((r) => $heatmapState[r.year].visible));
    // The header's "last calculated" stamp is the NEWEST of the available years.
    const newestAt = $derived(
        HEAT_YEARS.reduce<string | null>((best, y) => {
            const s = $heatmapState[y];
            if (!s.available || !s.generatedAt) return best;
            const t = Date.parse(s.generatedAt);
            if (!Number.isFinite(t)) return best;
            return best === null || t > Date.parse(best) ? s.generatedAt : best;
        }, null)
    );
</script>

<!-- `count` IS the stamp slot — Section takes no snippet after its label, and `count` is
     typed `number | string` and renders in a muted mono span.

     The collapse FALLBACK is a flat `false` (expanded), not the siblings' `!visible`: those
     sections are default-ON so `!visible` reads as "you turned this off, fold it away", but
     these layers are default-OFF by design and that rule would hide the whole feature behind
     a chevron on every first visit. A stored value still wins. -->
<Section
    label="Heat Map"
    count={relativeStamp(newestAt)}
    master={allOn}
    onmaster={(v) => {
        for (const r of shown) void layer?.setVisible(r.year, v);
    }}
    collapsed={$layerSectionCollapse[SECTION.heatmap] ?? false}
    ontoggle={(c) => setSectionCollapsed(SECTION.heatmap, c)}
    hint="Every submitted run drawn as one translucent line — overlap is heat."
>
    {#each shown as r (r.year)}
        <!-- Exact timestamp + counts reach the user through the hint bar's `data-hint`,
             never a native hover tooltip. -->
        <Row
            checked={$heatmapState[r.year].visible}
            onchange={(v) => void layer?.setVisible(r.year, v)}
            color={HEAT_PAINT[r.year]['line-color']}
            label={r.label}
            hint={detail($heatmapState[r.year])}
        />
    {/each}
</Section>
