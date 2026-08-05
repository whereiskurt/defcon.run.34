<script lang="ts">
    // The "ELKENTARO 2000" — a side-view cartoon treadmill that stands in for the
    // route thumbnail on a GPS-less (indoor) Strava card.
    //
    // Occupies the SAME 130x56 viewBox as the polyline path it replaces, so the
    // carousel cards keep a uniform height whether or not an activity has GPS.
    // Drawn in the same flat side-on style as the shuttle buses and payphones
    // rather than a lucide icon, because a blank grey box reads as "broken"
    // where a little machine reads as "indoor run, on purpose".
    //
    // Layout note: the machine is deliberately confined to y≈4–48 so the brand
    // plate along the bottom has its own clear band. A first pass put the deck at
    // y=40–46 with the text at y=55 and the rollers sat right on top of the
    // lettering, clipping the leading "E".
    //
    // Named for the run that surfaced the bug: a treadmill activity called
    // "Elkentaro Made Me" was silently dropped from the strip entirely.

    let { muted = false }: { muted?: boolean } = $props();

    // Strava orange normally; muted (grey) once the card is tagged and inert, so
    // the glyph dims in step with the rest of the card.
    const ink = $derived(muted ? 'currentColor' : '#fc4c02');
</script>

<svg
    viewBox="0 0 130 56"
    class="w-full {muted ? 'text-muted-foreground' : ''}"
    role="img"
    aria-label="Indoor treadmill run — no GPS route"
>
    <!-- Console head -->
    <rect
        x="13"
        y="4"
        width="25"
        height="12"
        rx="2.5"
        fill="none"
        stroke={ink}
        stroke-width="2.4"
    />
    <!-- Console readout: three bars, the universal "stats" shorthand -->
    <path
        d="M19 12.5 L19 8.5 M25 12.5 L25 10 M31 12.5 L31 7.5"
        fill="none"
        stroke={ink}
        stroke-width="1.5"
        stroke-linecap="round"
        opacity="0.85"
    />
    <!-- Mast down to the deck -->
    <path
        d="M25.5 16 L25.5 34"
        fill="none"
        stroke={ink}
        stroke-width="2.4"
        stroke-linecap="round"
    />
    <!-- Handrail reaching forward over the belt -->
    <path
        d="M25.5 21 L45 21"
        fill="none"
        stroke={ink}
        stroke-width="2.1"
        stroke-linecap="round"
    />

    <!-- Deck: the angled running belt -->
    <path
        d="M21 34 L99 34 L107 40 L29 40 Z"
        fill="none"
        stroke={ink}
        stroke-width="2.4"
        stroke-linejoin="round"
    />
    <!-- Belt tread marks -->
    <path
        d="M43 34 L39 40 M59 34 L55 40 M75 34 L71 40 M91 34 L87 40"
        fill="none"
        stroke={ink}
        stroke-width="1.3"
        stroke-linecap="round"
        opacity="0.5"
    />

    <!-- Rollers -->
    <circle cx="104" cy="43.5" r="2.8" fill="none" stroke={ink} stroke-width="1.9" />
    <circle cx="26" cy="43.5" r="2.8" fill="none" stroke={ink} stroke-width="1.9" />

    <!-- Little runner mid-stride on the deck -->
    <g fill="none" stroke={ink} stroke-width="2.1" stroke-linecap="round">
        <circle cx="70" cy="9" r="4" />
        <path d="M70 13 L67 24" />
        <!-- arms: one driving forward, one back -->
        <path d="M68.5 17 L76 15 M68.5 18 L61 21" />
        <!-- legs: mid-stride, feet meeting the belt -->
        <path d="M67 24 L74 33 M67 24 L60 34" />
    </g>

    <!-- Brand plate, in its own clear band along the bottom -->
    <text
        x="65"
        y="54"
        text-anchor="middle"
        font-size="7.5"
        font-weight="700"
        letter-spacing="0.8"
        fill={ink}
        opacity="0.9">ELKENTARO 2000</text
    >
</svg>
