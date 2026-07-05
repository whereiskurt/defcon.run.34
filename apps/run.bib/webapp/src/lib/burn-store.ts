"use client";

/**
 * Tiny cross-component bridge for the "🔥 Fuck your bib" opt-out (Kurt
 * 2026-07-05), mirroring `rain-store.ts`.
 *
 * The contribution choice control (ContributionChoice) lives in the tile grid,
 * while the bib name form + preview live in GetYourBib/BibForm — they are not
 * React siblings, so the "burned" view state crosses the boundary via this
 * module-level singleton (there is only ever one orderform on the page). When
 * burned, BibForm hides the name form + preview and renders <BurningBib/>.
 *
 * Client-only view state — the server (bib.burned) is the source of truth and
 * seeds the initial value; this just carries live toggles between the two
 * sibling subtrees.
 */
type BurnSub = (burning: boolean) => void;

let burning = false;
const subs = new Set<BurnSub>();

/** Current burn state — lets a late subscriber seed itself on mount. */
export function getBurning(): boolean {
  return burning;
}

/** Set the burn state and notify every subscriber. */
export function setBurning(value: boolean): void {
  burning = value;
  for (const cb of subs) cb(burning);
}

/** Subscribe to burn-state changes; returns an unsubscribe fn. */
export function subscribe(cb: BurnSub): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
