<script lang="ts">
    import {
        publicOverlayGroups,
        publicAggregate,
        publicCheckIns,
        checkinFilters,
        prettyRouteName,
        CHECKIN_USER_TYPES,
    } from '../public-overlays';
    import type { PublicOverlaysLayer, CheckinWindow } from '../public-overlays';

    const CHECKIN_WINDOWS: { key: CheckinWindow; label: string }[] = [
        { key: 'hour', label: 'Hour' },
        { key: 'today', label: 'Today' },
        { key: 'all', label: 'Whole con' },
    ];

    // Chip label + color per user type (rabbit/admin/wildhare/og).
    const TYPE_META: Record<string, { label: string; color: string }> = {
        rabbit: { label: '🐇 Rabbit', color: '#e6007a' },
        admin: { label: '★ Admin', color: '#f4a240' },
        wildhare: { label: '⚡ Wildhare', color: '#00c2b8' },
        og: { label: '☆ OG', color: '#8b5cf6' },
    };

    // Toggle a user-type chip in the (multi-select) type filter. [] = all.
    function toggleType(t: string) {
        const cur = $checkinFilters.types;
        const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
        layer?.setCheckInFilters({ types: next });
    }

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
                <!-- 4-5 char handle/code match: shows only check-ins whose name matches -->
                <input
                    type="text"
                    maxlength="16"
                    placeholder="match a handle…"
                    value={$checkinFilters.match}
                    oninput={(e) => layer?.setCheckInFilters({ match: e.currentTarget.value })}
                    class="w-full rounded border border-border bg-transparent px-2 py-0.5 text-xs"
                />
                <!-- User-type chips (multi-select; none selected = all types) -->
                <div class="flex flex-row flex-wrap gap-1">
                    {#each CHECKIN_USER_TYPES as t (t)}
                        {@const on = $checkinFilters.types.includes(t)}
                        <button
                            type="button"
                            class="rounded-full px-2 py-0.5 text-xs border transition-colors {on
                                ? 'font-semibold'
                                : 'border-border hover:bg-accent'}"
                            style={on
                                ? `border-color:${TYPE_META[t].color};background:${TYPE_META[t].color}22;color:${TYPE_META[t].color}`
                                : ''}
                            onclick={() => toggleType(t)}
                        >
                            {TYPE_META[t].label}
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
