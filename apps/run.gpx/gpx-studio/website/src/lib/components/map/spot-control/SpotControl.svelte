<!--
    "The Spot" button — flies the map home to the DEF CON run rally point at
    LVCC West (the 🚨 beacon, the-spot.ts). Hoisted to the VERY TOP of the
    top-right control column (above the + zoom button). One tap re-centres a
    lost map (e.g. after wandering to the Tokyo rabbits) back in Las Vegas.
-->
<script lang="ts">
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { map } from '$lib/components/map/map';
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { TheSpot } from '$lib/components/map/the-spot';

    let inner: HTMLElement;

    onMount(() => {
        map.onLoad(() => {
            // Controls stack in add-order, and mapbox's own controls (zoom,
            // geocoder, geolocate) are added before any CustomControl mounts.
            // Hoist this control's container to the front of the corner so
            // the 🚨 sits above the + zoom button. setTimeout lets the child
            // CustomControl finish its own onLoad addControl first.
            setTimeout(() => {
                let ctrl: HTMLElement | null = inner;
                while (ctrl && ctrl.parentElement && !ctrl.parentElement.classList.contains('mapboxgl-ctrl-top-right')) {
                    ctrl = ctrl.parentElement;
                }
                const corner = ctrl?.parentElement;
                if (ctrl && corner && corner.firstChild !== ctrl) {
                    corner.insertBefore(ctrl, corner.firstChild);
                }
            }, 0);
        });
    });

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
        <span bind:this={inner} class="text-[17px] leading-none select-none" aria-hidden="true">🚨</span>
    </ButtonWithTooltip>
</CustomControl>
