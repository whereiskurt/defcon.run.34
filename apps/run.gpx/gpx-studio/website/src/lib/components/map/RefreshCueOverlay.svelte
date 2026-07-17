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
                <span class="lbl">{c.label} ↻ {remaining(c)}s</span>
            </div>
        {/each}
    </div>
{/if}

<style>
    .dc34-refresh-cues {
        position: fixed;
        right: 12px;
        bottom: 34px;
        /* Above the ghost-mode matrix overlay (canvas 2147483001 / tint
           2147483000) — else the ghosts cue, which only shows in ghost mode,
           is always buried, and the rabbits cue vanishes whenever ghost is on. */
        z-index: 2147483002;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        pointer-events: none;
    }
    .dc34-refresh-cue {
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(10, 10, 16, 0.72);
        color: #fff;
        padding: 3px 9px 3px 3px;
        border-radius: 999px;
        font: 11px/1 system-ui, -apple-system, sans-serif;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
    }
    .dc34-refresh-cue svg {
        width: 22px;
        height: 22px;
        transform: rotate(-90deg);
    }
    .dc34-refresh-cue .track {
        fill: none;
        stroke: rgba(255, 255, 255, 0.2);
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
</style>
