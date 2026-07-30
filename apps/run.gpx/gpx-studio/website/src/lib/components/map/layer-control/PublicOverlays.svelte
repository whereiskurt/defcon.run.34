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
    import { Section, Row, Chips, Chip } from '$lib/components/dialog-shell/index.js';

    // Per-group collapse state (keyed by folderId), like the basemap/world tree.
    let collapsed = $state<Record<string, boolean>>({});

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

    // §9 "master collapse / off": the group master toggle drives the collapse state, not
    // just the checkbox click — so a programmatic setGroupVisible (e.g. the §5b "Check out
    // the routes" hub card) collapses/expands exactly like a manual click does. We track each
    // group's previous visible value (plain object, not $state — it's bookkeeping, not UI) and
    // only re-derive `collapsed` on an actual ON/OFF transition. That keeps the manual chevron
    // free to fold/unfold the list on its own afterwards without the effect fighting it on
    // every unrelated re-render (visible unchanged → no rewrite of collapsed).
    let prevGroupVisible: Record<string, boolean> = {};
    $effect(() => {
        for (const group of $publicOverlayGroups) {
            if (prevGroupVisible[group.folderId] !== group.visible) {
                prevGroupVisible[group.folderId] = group.visible;
                collapsed[group.folderId] = !group.visible;
            }
        }
    });

    // Same idiom for the check-ins block. Turning the master off now folds the filter body
    // away instead of unmounting it, so the collapse affordance stays usable afterwards.
    let checkinsCollapsed = $state(true);
    let prevCheckinsVisible: boolean | undefined;
    $effect(() => {
        if (prevCheckinsVisible !== $publicCheckIns.visible) {
            prevCheckinsVisible = $publicCheckIns.visible;
            checkinsCollapsed = !$publicCheckIns.visible;
        }
    });
</script>

{#if $publicAggregate.available}
    <Section
        label="All Runners"
        collapsible={false}
        master={$publicAggregate.visible}
        onmaster={(v) => layer?.setAggregateVisible(v)}
        hint="One blended, non-attributable layer of every runner's tracks."
    />
{/if}

{#if $publicCheckIns.available}
    <Section
        label="User Check-ins"
        count={$publicCheckIns.count}
        master={$publicCheckIns.visible}
        onmaster={(v) => layer?.setCheckInsVisible(v)}
        collapsed={checkinsCollapsed}
        ontoggle={(c) => (checkinsCollapsed = c)}
        hint="Public check-ins from runners on the mesh."
    >
        <Chips
            options={CHECKIN_WINDOWS}
            value={$checkinFilters.window}
            onselect={(k) => layer?.setCheckInFilters({ window: k as CheckinWindow })}
            hint="Limit check-ins to a time window."
        />

        <!-- 4-5 char handle/code match: shows only check-ins whose name matches -->
        <div class="px-3 py-1">
            <input
                type="text"
                maxlength="16"
                placeholder="match a handle…"
                value={$checkinFilters.match}
                oninput={(e) => layer?.setCheckInFilters({ match: e.currentTarget.value })}
                data-hint="Show only check-ins whose handle matches."
                class="w-full rounded border border-border bg-transparent px-2 py-0.5 text-xs focus:border-primary"
            />
        </div>

        <!-- User-type chips (multi-select; none selected = all types), then the runner clear chip -->
        <div class="flex flex-wrap gap-1.5 px-3 py-1">
            {#each CHECKIN_USER_TYPES as t (t)}
                <Chip
                    label={TYPE_META[t].label}
                    on={$checkinFilters.types.includes(t)}
                    color={TYPE_META[t].color}
                    onclick={() => toggleType(t)}
                    hint={'Show only ' + TYPE_META[t].label + ' check-ins.'}
                />
            {/each}
            {#if $checkinFilters.runner}
                <Chip
                    label={'only 🐇 ' + $checkinFilters.runner + ' ✕'}
                    on={true}
                    onclick={() => layer?.setCheckInFilters({ runner: null })}
                    hint="Clear the runner highlight and show everyone."
                />
            {/if}
        </div>
    </Section>
{/if}

{#each $publicOverlayGroups as group (group.folderId)}
    <!-- "Maps" -> "Routes" for consistent language (Kurt 2026-07-11);
         the underlying GLOBAL folder is still named "DEF CON 34 Maps". -->
    <Section
        label={group.folderName.replace(/\bMaps\b/, 'Routes')}
        count={group.maps.length}
        master={group.visible}
        onmaster={(v) => layer?.setGroupVisible(group.folderId, v)}
        collapsed={!!collapsed[group.folderId]}
        ontoggle={(c) => (collapsed[group.folderId] = c)}
    >
        {#each group.maps as m (m.fileId)}
            <!-- The CMS shortDescription reaches the user through the hint bar, never a
                 native hover tooltip — that tooltip was the reported hover-stutter cause. -->
            <Row
                checked={m.visible}
                onchange={(v) => layer?.setRouteVisible(m.fileId, v)}
                color={m.color}
                label={m.title || prettyRouteName(m.fileName)}
                hint={m.shortDescription}
            />
        {/each}
    </Section>
{/each}
