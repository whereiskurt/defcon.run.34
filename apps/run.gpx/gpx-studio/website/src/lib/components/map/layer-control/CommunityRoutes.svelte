<script lang="ts">
    import { communityRoutes } from '../community-routes';
    import type { CommunityRoutesLayer } from '../community-routes';
    import { routeColor } from '$lib/dc34-palette';
    import { Section, Row } from '$lib/components/dialog-shell/index.js';

    // The layer instance is created in LayerControl's map.onLoad; may be
    // undefined for the first frame before the map loads.
    let { layer }: { layer: CommunityRoutesLayer | undefined } = $props();

    let collapsed = $state(true);

    const allVisible = $derived(
        $communityRoutes.length > 0 && $communityRoutes.every((r) => r.visible)
    );

    // This file's simpler form of the master-off-collapses rule: one group, so the
    // cascade and the fold happen in the same call.
    function toggleAll(visible: boolean) {
        layer?.setAllVisible(visible);
        collapsed = !visible;
    }
</script>

{#if $communityRoutes.length > 0}
    <Section
        label="Community Routes"
        count={$communityRoutes.length}
        master={allVisible}
        onmaster={toggleAll}
        collapsed={collapsed}
        ontoggle={(c) => (collapsed = c)}
    >
        {#each $communityRoutes as route, i (route.routeId)}
            <Row
                checked={route.visible}
                onchange={(v) => layer?.setRouteVisible(route.routeId, v)}
                color={routeColor(i)}
                label={route.name}
                hint="Published route from another runner — toggle to draw it on the map."
            />
        {/each}
    </Section>
{/if}
