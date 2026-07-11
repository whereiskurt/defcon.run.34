<script lang="ts">
    import {
        publicOverlayGroups,
        publicAggregate,
        publicCheckIns,
        checkinFilters,
        prettyRouteName,
    } from '../public-overlays';
    import type { PublicOverlaysLayer, CheckinWindow } from '../public-overlays';

    const CHECKIN_WINDOWS: { key: CheckinWindow; label: string }[] = [
        { key: 'hour', label: 'Hour' },
        { key: 'today', label: 'Today' },
        { key: 'all', label: 'Whole con' },
    ];

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
    <div class="flex flex-col gap-1">
        <label class="flex flex-row items-center gap-2 text-sm font-semibold">
            <input
                type="checkbox"
                checked={$publicCheckIns.visible}
                onchange={(e) => layer?.setCheckInsVisible(e.currentTarget.checked)}
            />
            User Check-ins ({$publicCheckIns.count})
        </label>
        {#if $publicCheckIns.visible}
            <div class="flex flex-col gap-1 pl-5">
                <!-- Time window chips -->
                <div class="flex flex-row gap-1">
                    {#each CHECKIN_WINDOWS as w (w.key)}
                        <button
                            type="button"
                            class="rounded-full px-2 py-0.5 text-xs border transition-colors {$checkinFilters.window ===
                            w.key
                                ? 'border-primary bg-primary/15 font-semibold'
                                : 'border-border hover:bg-accent'}"
                            onclick={() => layer?.setCheckInFilters({ window: w.key })}
                        >
                            {w.label}
                        </button>
                    {/each}
                </div>
                <!-- Runner highlight clear chip -->
                {#if $checkinFilters.runner}
                    <button
                        type="button"
                        class="self-start rounded-full px-2 py-0.5 text-xs border border-primary bg-primary/15"
                        title="Show all runners"
                        onclick={() => layer?.setCheckInFilters({ runner: null })}
                    >
                        only 🐇 {$checkinFilters.runner} ✕
                    </button>
                {/if}
            </div>
        {/if}
    </div>
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
                    <!-- "Maps" -> "Routes" for consistent language (Kurt 2026-07-11);
                         the underlying GLOBAL folder is still named "DEF CON 34 Maps". -->
                    {group.folderName.replace(/\bMaps\b/, 'Routes')}
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
