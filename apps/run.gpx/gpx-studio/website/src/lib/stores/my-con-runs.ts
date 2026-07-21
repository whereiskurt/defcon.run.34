import { writable } from 'svelte/store';

/** Bump to make the My DEF CON Runs layer re-fetch its manifest (post-import / re-tag). */
export const myConRunsRefresh = writable<number>(0);

export function refreshMyConRuns(): void {
    myConRunsRefresh.update((n) => n + 1);
}

/** One-shot command: after the reload triggered by the bump above finishes,
 * LayerControl reveals this run (visible day group + fit bounds + click-popup)
 * then resets this back to null — same one-shot idiom as quickStartAction.
 * Set this BEFORE calling refreshMyConRuns() so it's already in place when the
 * reload completes (UAT round 3 fix B: Strava strip import/tag success paths
 * present the run via the My DEF CON Runs layer instead of landing a second,
 * editable file). */
export const myConRunsReveal = writable<{ fileId: string } | null>(null);

export function requestConRunReveal(fileId: string): void {
    myConRunsReveal.set({ fileId });
}
