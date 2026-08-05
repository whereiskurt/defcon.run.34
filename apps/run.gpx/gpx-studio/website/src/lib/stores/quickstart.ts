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
 * One-shot request to open the QuickStart hub, carrying WHICH screen to open.
 * QuickStartHub honours it and resets this to null.
 *
 * Was a plain boolean. It now names a target because the two callers want
 * different things: the in-studio buttons (menu bar, mobile FAB, My Routes
 * footer) open the three-card hub, but the `?addrun` deep link from
 * run.defcon.run comes from someone who already pressed a button labelled
 * "+Activity" — making them pick "Record Activity" out of three cards is asking
 * the same question twice.
 */
export type QuickStartTarget = 'hub' | 'logrun';

export const quickStartOpen = writable<QuickStartTarget | null>(null);
