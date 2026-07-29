<!--
    "The Spot" button — flies the map home to the DEF CON run rally point at
    LVCC West (the 🚨 beacon, the-spot.ts). Sits where the street-view button
    used to be, at the top of the custom control stack. One tap re-centres a
    lost map (e.g. after wandering to the Tokyo rabbits) back in Las Vegas.
-->
<script lang="ts">
    import { get } from 'svelte/store';
    import { map } from '$lib/components/map/map';
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { TheSpot } from '$lib/components/map/the-spot';

    function flyToSpot() {
        const m = get(map);
        if (!m) return;
        m.flyTo({
            center: TheSpot.location,
            zoom: 16,
            pitch: 0,
            bearing: 0,
            essential: true,
        });
    }
</script>

<CustomControl class="w-[29px] h-[29px] shrink-0">
    <ButtonWithTooltip
        variant="ghost"
        class="w-full h-full"
        side="left"
        label="The Spot — LVCC rally point, 0600"
        onclick={flyToSpot}
    >
        <span class="text-[17px] leading-none select-none" aria-hidden="true">🚨</span>
    </ButtonWithTooltip>
</CustomControl>
