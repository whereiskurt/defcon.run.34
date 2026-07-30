<script lang="ts">
    import { myConRunGroups } from '../my-con-runs';
    import type { MyConRunsLayer } from '../my-con-runs';
    import { prettyRouteName } from '../public-overlays';
    import { routeColor } from '$lib/dc34-palette';
    import { Section, Row } from '$lib/components/dialog-shell/index.js';

    // The layer instance is created in LayerControl's map.onLoad; may be undefined
    // for the first frame before the map loads.
    let { layer }: { layer: MyConRunsLayer | undefined } = $props();

    // Per-group collapse state (keyed by conDay), like PublicOverlays.
    let collapsed = $state<Record<string, boolean>>({});

    // Mirrors PublicOverlays: the group master toggle drives the collapse state
    // on an actual ON/OFF transition, without fighting a manual chevron click.
    let prevGroupVisible: Record<string, boolean> = {};
    $effect(() => {
        for (const group of $myConRunGroups) {
            if (prevGroupVisible[group.conDay] !== group.visible) {
                prevGroupVisible[group.conDay] = group.visible;
                collapsed[group.conDay] = !group.visible;
            }
        }
    });

    // Whole-section collapse + master, sitting above the per-day sub-sections.
    let rootCollapsed = $state(false);
    const totalRuns = $derived($myConRunGroups.reduce((n, g) => n + g.runs.length, 0));
    const allDaysVisible = $derived(
        $myConRunGroups.length > 0 && $myConRunGroups.every((g) => g.visible)
    );

    // The section-wide cascade passes fit = false so one master click does not fire a
    // fitBounds per con day; the per-day toggle keeps the default fit, unchanged.
    function setAllDays(v: boolean) {
        for (const g of $myConRunGroups) layer?.setDayVisible(g.conDay, v, false);
    }
</script>

{#if $myConRunGroups.length > 0}
    <Section
        label="My DEF CON Runs"
        count={totalRuns}
        master={allDaysVisible}
        onmaster={setAllDays}
        collapsed={rootCollapsed}
        ontoggle={(c) => (rootCollapsed = c)}
    >
        {#each $myConRunGroups as group, i (group.conDay)}
            <!-- The plain sub-section variant drops the nested card chrome and keeps just
                 the indented header idiom, so there is exactly one collapse affordance at
                 each level. -->
            <Section
                variant="plain"
                label={group.label}
                count={group.runs.length}
                master={group.visible}
                onmaster={(v) => layer?.setDayVisible(group.conDay, v)}
                collapsed={!!collapsed[group.conDay]}
                ontoggle={(c) => (collapsed[group.conDay] = c)}
            >
                {#each group.runs as r (r.fileId)}
                    <!-- The day's colour dot moves from the header onto each run row, so the
                         per-day colour identity survives the re-skin. -->
                    <Row
                        checked={r.visible}
                        onchange={(v) => layer?.setRunVisible(r.fileId, v)}
                        color={routeColor(i)}
                        label={prettyRouteName(r.fileName)}
                        hint={group.label + ' · your imported run'}
                    />
                {/each}
            </Section>
        {/each}
    </Section>
{/if}
