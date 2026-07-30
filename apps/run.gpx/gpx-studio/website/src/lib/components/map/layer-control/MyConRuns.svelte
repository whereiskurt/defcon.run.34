<script lang="ts">
    import { myConRunGroups } from '../my-con-runs';
    import type { MyConRunsLayer } from '../my-con-runs';
    import { prettyRouteName } from '../public-overlays';
    import { routeColor } from '$lib/dc34-palette';
    import { Section, Row } from '$lib/components/dialog-shell/index.js';
    import {
        layerSectionCollapse,
        setSectionCollapsed,
        conDaySection,
        SECTION,
    } from '$lib/stores/layer-section-collapse';

    // The layer instance is created in LayerControl's map.onLoad; may be undefined
    // for the first frame before the map loads.
    let { layer }: { layer: MyConRunsLayer | undefined } = $props();

    // Collapse state lives in the persisted store, NOT in a rune here: this component
    // renders inside the portalled dialog, whose subtree is destroyed on close, so any
    // rune would reset to its literal default on every reopen (the reported bug).

    // Mirrors PublicOverlays: the group master toggle drives the collapse state
    // on an actual ON/OFF transition, without fighting a manual chevron click.
    // `undefined` marks a group this mount has not seen yet — see PublicOverlays for
    // why the first sighting seeds the baseline instead of writing collapse.
    let prevGroupVisible: Record<string, boolean> = {};
    $effect(() => {
        for (const group of $myConRunGroups) {
            const prev = prevGroupVisible[group.conDay];
            prevGroupVisible[group.conDay] = group.visible;
            if (prev !== undefined && prev !== group.visible) {
                setSectionCollapsed(conDaySection(group.conDay), !group.visible);
            }
        }
    });

    // Whole-section collapse + master, sitting above the per-day sub-sections.
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
        collapsed={$layerSectionCollapse[SECTION.myConRuns] ?? false}
        ontoggle={(c) => setSectionCollapsed(SECTION.myConRuns, c)}
    >
        {#each $myConRunGroups as group, i (group.conDay)}
            <!-- The plain sub-section variant drops the nested card chrome and keeps just
                 the indented header idiom, so there is exactly one collapse affordance at
                 each level.

                 Collapse fallback is `!group.visible` so a day with no stored preference
                 opens exactly as it did before this store existed (the mount-time effect
                 used to derive it from visibility). A stored value wins. -->
            <Section
                variant="plain"
                label={group.label}
                count={group.runs.length}
                master={group.visible}
                onmaster={(v) => layer?.setDayVisible(group.conDay, v)}
                collapsed={$layerSectionCollapse[conDaySection(group.conDay)] ?? !group.visible}
                ontoggle={(c) => setSectionCollapsed(conDaySection(group.conDay), c)}
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
