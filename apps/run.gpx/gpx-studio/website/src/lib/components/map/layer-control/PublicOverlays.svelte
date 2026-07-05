<script lang="ts">
    import {
        publicOverlayGroups,
        publicAggregate,
        publicCheckIns,
        prettyRouteName,
    } from '../public-overlays';
    import type { PublicOverlaysLayer } from '../public-overlays';

    // The layer instance is created in LayerControl's map.onLoad; may be undefined
    // for the first frame before the map loads.
    let { layer }: { layer: PublicOverlaysLayer | undefined } = $props();
</script>

{#if $publicAggregate.available}
    <label class="flex flex-row items-center gap-2 text-sm font-semibold">
        <input
            type="checkbox"
            checked={$publicAggregate.visible}
            onchange={(e) => layer?.setAggregateVisible(e.currentTarget.checked)}
        />
        All Runners
    </label>
{/if}

{#if $publicCheckIns.available}
    <label class="flex flex-row items-center gap-2 text-sm font-semibold">
        <input
            type="checkbox"
            checked={$publicCheckIns.visible}
            onchange={(e) => layer?.setCheckInsVisible(e.currentTarget.checked)}
        />
        User Check-ins ({$publicCheckIns.count})
    </label>
{/if}

{#if $publicOverlayGroups.length > 0}
    <div class="flex flex-col gap-1 text-sm">
        {#each $publicOverlayGroups as group (group.folderId)}
            <div class="flex flex-col gap-0.5">
                <!-- Group master toggle: the "DEF CON 34 maps on/off" control -->
                <label class="flex flex-row items-center gap-2 font-semibold">
                    <input
                        type="checkbox"
                        checked={group.visible}
                        onchange={(e) =>
                            layer?.setGroupVisible(group.folderId, e.currentTarget.checked)}
                    />
                    {group.folderName}
                </label>
                <!-- Per-route toggles -->
                <div class="flex flex-col gap-0.5 pl-5">
                    {#each group.maps as m (m.fileId)}
                        <label class="flex flex-row items-center gap-2" title={m.shortDescription ?? ''}>
                            <input
                                type="checkbox"
                                checked={m.visible}
                                onchange={(e) =>
                                    layer?.setRouteVisible(m.fileId, e.currentTarget.checked)}
                            />
                            <span
                                class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                                style="background-color: {m.color}"
                            ></span>
                            {m.title || prettyRouteName(m.fileName)}
                        </label>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
{/if}
