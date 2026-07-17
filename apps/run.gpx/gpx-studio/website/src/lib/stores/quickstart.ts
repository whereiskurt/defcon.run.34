import { writable } from 'svelte/store';

/**
 * One-shot command from the QuickStart card hub (Phase 60) to LayerControl,
 * which owns the public-overlay and rabbit layer instances. The card sets an
 * action; LayerControl reacts (turn all DEF CON routes on / ensure the rabbit
 * runner layer is on) and resets it to null.
 *
 * Deliberately does NOT expose ghost mode — the "Show me the runners" card only
 * ever touches the rabbit layer.
 */
export type QuickStartAction = 'routes' | 'runners';

export const quickStartAction = writable<QuickStartAction | null>(null);

/**
 * One-shot request to open the QuickStart hub, fired by the "Add run" button
 * that now lives in the top menu bar (the corner launcher was moved there).
 * QuickStartHub opens its hub view and resets this to false.
 */
export const quickStartOpen = writable<boolean>(false);
