"use client";

/**
 * Tiny cross-component bridge so the pay-in-person checkbox
 * (WillPayInPersonCheckbox) can rain cash over the bib preview
 * (BibForm/CashRain) after Plan 34-03 moved the checkbox out of the
 * GetYourBib section and into the Sponsor/Donate tile grid — the two are no
 * longer React siblings, so a shared prop no longer reaches across.
 *
 * Mirrors `pending-bib-save.ts`: a module-level singleton (there is only ever
 * one orderform on the page). The checkbox pushes its checked state via
 * `setRaining`; BibForm `subscribe`s and threads the value into <CashRain>.
 *
 * Client-only cosmetic state — no server trust decision depends on it
 * (threat T-34-08, accepted).
 */
type RainSub = (raining: boolean) => void;

let raining = false;
const subs = new Set<RainSub>();

/** Current rain state — lets a late subscriber seed itself on mount. */
export function getRaining(): boolean {
  return raining;
}

/** Set the rain state and notify every subscriber. */
export function setRaining(value: boolean): void {
  raining = value;
  for (const cb of subs) cb(raining);
}

/** Subscribe to rain-state changes; returns an unsubscribe fn. */
export function subscribe(cb: RainSub): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
