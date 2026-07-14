/**
 * ctf-covert-css — the covert return channel builder (CTF-08).
 *
 * The covert endpoint always emits `text/css`. On a genuine credited hit it
 * returns the sheet from `buildWinSheet(n)`; every other outcome returns
 * `buildDecoySheet()`. The ONLY observable difference is the presence of one
 * innocuous theme custom property (`AWARD_PROP`) carrying the credited number —
 * the egg client reads it back with `getComputedStyle` (a computed-style read,
 * not a network event).
 *
 * Invisibility invariants:
 *  - Presence-only marker: the decoy carries a same-length filler declaration
 *    (a DIFFERENT theme token), so `AWARD_PROP` appears ONLY on a win.
 *  - Byte-plausible: |len(decoy) - len(win)| <= SIZE_TOLERANCE across the
 *    representative number range (T-46-02: no size-leak of the credited state).
 *  - The emitted bytes read as a plain theme stylesheet — no wording that names
 *    the game, the channel, or the marker's meaning.
 *
 * Pure module: no I/O, no logging.
 */

/** The theme-token custom property the egg client reads back. Single shared contract. */
export const AWARD_PROP = "--accent-ramp";

/** Filler token used by the decoy — same length as AWARD_PROP, never read. */
const FILLER_PROP = "--accent-fill";

/**
 * Max tolerated byte delta between decoy and win bodies. The marker declaration
 * differs from the filler only by the digit count of the number (1..5 digits vs
 * a fixed 3), so the real spread is <= 2; 8 leaves generous slack.
 */
export const SIZE_TOLERANCE = 8;

/** A believable base theme sheet shared by both outcomes. */
const BASE = `:root {
  --bg: #0b0f14;
  --fg: #e6edf3;
  --muted: #8b98a5;
  --radius: 8px;
  --gap: 12px;
}
.theme-surface { background: var(--bg); color: var(--fg); }
.theme-muted { color: var(--muted); }
`;

/** The plain sheet: base + a same-length innocuous filler declaration. */
export function buildDecoySheet(): string {
  return `${BASE}:root { ${FILLER_PROP}: 000; }\n`;
}

/** The credited sheet: base + the marker declaration carrying the number. */
export function buildWinSheet(points: number): string {
  return `${BASE}:root { ${AWARD_PROP}: ${points}; }\n`;
}
