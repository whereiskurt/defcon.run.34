import { writable } from 'svelte/store';

/**
 * Refresh-cue store — the reactive source of truth behind the on-map countdown
 * ring(s). A polling map layer flips its cue on when it becomes visible, resets
 * it on every successful poll, and turns it off when hidden. `<RefreshCueOverlay>`
 * (rendered once in LayerControl's DOM tree) subscribes and draws the rings.
 *
 * This deliberately replaces the old imperative `document.body`-append cue, which
 * never reliably appeared on the live map: by living in the studio's own Svelte
 * tree, the overlay renders whenever LayerControl does.
 */
export type CueKey = 'rabbits' | 'ghosts';

export interface CueState {
    active: boolean;
    label: string;
    periodMs: number;
    /** performance.now() timestamp of the last countdown reset. */
    resetAt: number;
    /** Ring color (matches the layer's pins). */
    color: string;
}

type Cues = Record<CueKey, CueState>;

function nowMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const initial: Cues = {
    rabbits: { active: false, label: 'rabbits', periodMs: 45_000, resetAt: 0, color: '#e6007a' },
    ghosts: { active: false, label: 'ghosts', periodMs: 90_000, resetAt: 0, color: '#9b5de5' },
};

export const refreshCues = writable<Cues>(initial);

/** Layer became visible: start (and reset) the countdown. */
export function startCue(key: CueKey, periodMs: number): void {
    refreshCues.update((s) => ({
        ...s,
        [key]: { ...s[key], active: true, periodMs, resetAt: nowMs() },
    }));
}

/** Successful poll: restart the countdown (no-op if the cue isn't active). */
export function resetCue(key: CueKey): void {
    refreshCues.update((s) =>
        s[key].active ? { ...s, [key]: { ...s[key], resetAt: nowMs() } } : s
    );
}

/** Layer hidden/removed: hide the cue. */
export function stopCue(key: CueKey): void {
    refreshCues.update((s) => ({ ...s, [key]: { ...s[key], active: false } }));
}
