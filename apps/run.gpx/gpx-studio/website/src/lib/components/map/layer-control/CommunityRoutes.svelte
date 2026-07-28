<script lang="ts">
    import { communityRoutes } from '../community-routes';
    import type { CommunityRoutesLayer } from '../community-routes';
    import { routeColor } from '$lib/dc34-palette';
    import { ChevronDown, ChevronRight } from '@lucide/svelte';

    // The layer instance is created in LayerControl's map.onLoad; may be
    // undefined for the first frame before the map loads.
    let { layer }: { layer: CommunityRoutesLayer | undefined } = $props();

    let collapsed = $state(true);

    const allVisible = $derived(
        $communityRoutes.length > 0 && $communityRoutes.every((r) => r.visible)
    );

    function toggleAll(visible: boolean) {
        layer?.setAllVisible(visible);
        collapsed = !visible;
    }
</script>

{#if $communityRoutes.length > 0}
    <div class="flex flex-col gap-0.5 text-sm">
        <div class="flex flex-row items-center gap-1 font-semibold">
            <button
                type="button"
                class="shrink-0 opacity-70 hover:opacity-100"
                aria-label={collapsed ? 'Expand' : 'Collapse'}
                onclick={() => (collapsed = !collapsed)}
            >
                {#if collapsed}
                    <ChevronRight size="16" />
                {:else}
                    <ChevronDown size="16" />
                {/if}
            </button>
            <label class="flex grow flex-row items-center gap-2">
                <input
                    type="checkbox"
                    checked={allVisible}
                    onchange={(e) => toggleAll(e.currentTarget.checked)}
                />
                Community Routes ({$communityRoutes.length})
            </label>
        </div>
        {#if !collapsed}
            <div class="ml-6 flex flex-col gap-0.5">
                {#each $communityRoutes as route, i (route.routeId)}
                    <label class="flex flex-row items-center gap-2">
                        <input
                            type="checkbox"
                            checked={route.visible}
                            onchange={(e) =>
                                layer?.setRouteVisible(route.routeId, e.currentTarget.checked)}
                        />
                        <span
                            class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                            style="background-color: {routeColor(i)}"
                        ></span>
                        <span class="truncate">{route.name}</span>
                    </label>
                {/each}
            </div>
        {/if}
    </div>
{/if}
