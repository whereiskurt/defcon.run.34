<!--
  Hidden trigger for ghost mode. Keyboard: three '!' within 1200ms toggles it.
  Mobile: four rapid theme flips within 2000ms toggles it (the DC33 gesture) —
  we watch the mode-watcher `mode` store rather than a specific button.

  NOTE: `mode` from mode-watcher is not a classic Svelte store (no `.subscribe`);
  it's a Svelte 5 rune-backed reactive value exposing `.current` (see
  ModeSwitch.svelte / LayerControl.svelte for the established pattern in this
  codebase). We track it with `$effect` instead of the brief's `mode.subscribe()`.
-->
<script lang="ts">
    import { onMount } from 'svelte';
    import { mode } from 'mode-watcher';
    import { ghostMode, recordHit } from '$lib/stores/ghost';
    import { rainbowUnlocked } from '$lib/stores/rainbow';

    let keyBuf: number[] = [];
    let themeBuf: number[] = [];
    let typed = '';
    let firstMode = true;

    onMount(() => {
        const onKey = (e: KeyboardEvent) => {
            // Rainbow Bridges unlock: type "rainbow" anywhere (the reliable path;
            // the 3-rapid-3D-flip gesture is a bonus but hard to do by hand).
            if (e.key.length === 1) {
                typed = (typed + e.key.toLowerCase()).slice(-7);
                if (typed === 'rainbow') {
                    rainbowUnlocked.set(true);
                    typed = '';
                }
            }
            if (e.key !== '!') {
                keyBuf = [];
                return;
            }
            const r = recordHit(keyBuf, Date.now());
            keyBuf = r.buf;
            if (r.hit) ghostMode.update((v) => !v);
        };
        window.addEventListener('keydown', onKey);

        return () => {
            window.removeEventListener('keydown', onKey);
        };
    });

    $effect(() => {
        // mode.current flips on each theme toggle; count rapid flips.
        void mode.current; // establish reactive dependency
        if (firstMode) {
            firstMode = false;
            return; // ignore initial value
        }
        const r = recordHit(themeBuf, Date.now(), 2000, 4);
        themeBuf = r.buf;
        if (r.hit) ghostMode.update((v) => !v);
    });
</script>
