<script lang="ts">
    /**
     * On-map refresh countdown — a fixed bottom-right stack of depleting rings
     * ("rabbits ↻ Ns" / "ghosts ↻ Ns"), one per active polling layer. Driven by
     * the reactive `refreshCues` store; a single rAF loop bumps `tick` so the
     * remaining seconds + ring offset recompute each frame. Rendered once from
     * LayerControl so it lives in the studio's own DOM tree (unlike the old
     * imperative cue, which never reliably appeared on the live map).
     */
    import { refreshCues, type CueKey, type CueState } from '$lib/stores/refresh-cue';

    const R = 14;
    const CIRC = 2 * Math.PI * R;
    const ORDER: CueKey[] = ['rabbits', 'ghosts'];

    function nowMs(): number {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    let visible = $derived(ORDER.map((k) => $refreshCues[k]).filter((c) => c.active));

    // Frame counter — reading it inside the frac/remaining helpers registers a
    // reactive dependency, so the template redraws every animation frame. The
    // loop only runs while a cue is showing (re-armed when `visible` changes).
    let tick = $state(0);
    $effect(() => {
        if (visible.length === 0) return;
        let raf = requestAnimationFrame(function loop() {
            tick++;
            raf = requestAnimationFrame(loop);
        });
        return () => cancelAnimationFrame(raf);
    });

    function frac(c: CueState): number {
        void tick; // per-frame reactivity
        return Math.min(1, Math.max(0, (nowMs() - c.resetAt) / c.periodMs));
    }
    function remaining(c: CueState): number {
        return Math.max(0, Math.ceil((c.periodMs * (1 - frac(c))) / 1000));
    }
</script>

{#if visible.length > 0}
    <div class="dc34-refresh-cues">
        {#each visible as c (c.label)}
            <div class="dc34-refresh-cue">
                <svg viewBox="0 0 32 32" aria-hidden="true">
                    <circle class="track" cx="16" cy="16" r={R}></circle>
                    <circle
                        class="prog"
                        cx="16"
                        cy="16"
                        r={R}
                        style="stroke:{c.color};stroke-dasharray:{CIRC};stroke-dashoffset:{CIRC * frac(c)}"
                    ></circle>
                </svg>
                <span class="lbl">{c.label} ↻ <span class="secs">{remaining(c)}</span>s</span>
            </div>
        {/each}
    </div>
{/if}

<style>
    /* Inline in the top menu bar (far left). Flows with the bar, wraps its pills
       when there's no room, and carries no z-index so the menu dropdowns sit
       above it. Colors inherit the bar's foreground so it blends in. */
    .dc34-refresh-cues {
        display: flex;
        flex-flow: row wrap;
        align-items: center;
        gap: 4px 10px;
        pointer-events: none;
        color: inherit;
    }
    .dc34-refresh-cue {
        display: flex;
        align-items: center;
        gap: 5px;
        color: inherit;
        padding: 0 2px;
        font: 11px/1 system-ui, -apple-system, sans-serif;
    }
    .dc34-refresh-cue svg {
        width: 20px;
        height: 20px;
        transform: rotate(-90deg);
    }
    .dc34-refresh-cue .track {
        fill: none;
        stroke: currentColor;
        stroke-opacity: 0.25;
        stroke-width: 3;
    }
    .dc34-refresh-cue .prog {
        fill: none;
        stroke-width: 3;
        stroke-linecap: round;
        transition: stroke-dashoffset 0.12s linear;
    }
    .dc34-refresh-cue .lbl {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }
    /* Reserve width for up to two digits so the pill doesn't shift/jump when
       the countdown drops from two digits to one (e.g. 10s → 9s). */
    .dc34-refresh-cue .secs {
        display: inline-block;
        min-width: 2ch;
        text-align: right;
    }
</style>
