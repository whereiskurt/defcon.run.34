import { writable } from 'svelte/store';

/** Whether hidden ghost mode is active. */
export const ghostMode = writable(false);

/**
 * Rolling-window gesture detector (ported from run.human EggTrigger). Records a
 * hit at `now`, drops hits older than the window, and reports a trigger once the
 * count reaches the threshold (clearing the buffer so a later burst re-fires).
 */
export function recordHit(
    buf: number[],
    now: number,
    windowMs = 1200,
    threshold = 3
): { hit: boolean; buf: number[] } {
    const next = [...buf, now].filter((t) => now - t <= windowMs);
    if (next.length >= threshold) return { hit: true, buf: [] };
    return { hit: false, buf: next };
}
