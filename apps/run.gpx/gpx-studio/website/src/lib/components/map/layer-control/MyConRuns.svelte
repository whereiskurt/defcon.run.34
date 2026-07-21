<script lang="ts">
    import { myConRunGroups } from '../my-con-runs';
    import type { MyConRunsLayer } from '../my-con-runs';
    import { prettyRouteName } from '../public-overlays';
    import { routeColor } from '$lib/dc34-palette';
    import { ChevronDown, ChevronRight } from '@lucide/svelte';

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
</script>

{#if $myConRunGroups.length > 0}
    <div class="flex flex-col gap-1 text-sm">
        {#each $myConRunGroups as group, i (group.conDay)}
            <div class="flex flex-col gap-0.5">
                <!-- Group master toggle + collapse chevron -->
                <div class="flex flex-row items-center gap-1 font-semibold">
                    <button
                        type="button"
                        class="shrink-0 opacity-70 hover:opacity-100"
                        aria-label={collapsed[group.conDay] ? 'Expand' : 'Collapse'}
                        onclick={() => (collapsed[group.conDay] = !collapsed[group.conDay])}
                    >
                        {#if collapsed[group.conDay]}
                            <ChevronRight size="16" />
                        {:else}
                            <ChevronDown size="16" />
                        {/if}
                    </button>
                    <label class="flex flex-row items-center gap-2 grow">
                        <input
                            type="checkbox"
                            checked={group.visible}
                            onchange={(e) => layer?.setDayVisible(group.conDay, e.currentTarget.checked)}
                        />
                        <span
                            class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                            style="background-color: {routeColor(i)}"
                        ></span>
                        {group.label} ({group.runs.length})
                    </label>
                </div>
                <!-- Per-run toggles (collapsible) -->
                {#if !collapsed[group.conDay]}
                <div class="flex flex-col gap-0.5 pl-5">
                    {#each group.runs as r (r.fileId)}
                        <label class="flex flex-row items-center gap-2">
                            <input
                                type="checkbox"
                                checked={r.visible}
                                onchange={(e) => layer?.setRunVisible(r.fileId, e.currentTarget.checked)}
                            />
                            {prettyRouteName(r.fileName)}
                        </label>
                    {/each}
                </div>
                {/if}
            </div>
        {/each}
    </div>
{/if}
