"use client";

import { useEffect, useState } from "react";

/**
 * ALTCHA in-flight overlay store (Plan 34-04, Slice B — D-09 / B-T4).
 *
 * A tiny module-level singleton (mirrors `pending-bib-save.ts` / `rain-store.ts`)
 * that counts how many ALTCHA proof-of-work solves are in flight. `solveAltcha`
 * calls `begin()` at entry and `end()` in a `finally`, so EVERY caller (BibForm
 * save, the pay-in-person toggle, the checkout flush) drives one shared overlay.
 *
 * Why a COUNT and not a boolean: the checkout flush can fire a name-save PoW while
 * a toggle PoW is still resolving. A boolean would clear the overlay when the first
 * finishes; the count keeps it up until the LAST solve returns (0). `end()` floors
 * at 0 so an unbalanced call can never underflow and wedge the overlay off.
 *
 * The overlay itself (`components/AltchaOverlay.tsx`) subscribes via `useAltchaBusy`
 * and is mounted once in `app/providers.tsx`.
 */

let count = 0;
const subscribers = new Set<(busy: boolean) => void>();

function notify(): void {
  const busy = count > 0;
  for (const cb of subscribers) cb(busy);
}

/** Register one in-flight PoW and notify subscribers (busy=true on 0→1). */
export function begin(): void {
  count += 1;
  notify();
}

/** Retire one in-flight PoW; floored at 0. Notifies busy=false on 1→0. */
export function end(): void {
  count = Math.max(0, count - 1);
  notify();
}

/** Subscribe to busy changes. Returns an unsubscribe fn. */
export function subscribe(cb: (busy: boolean) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * React hook: `true` while any ALTCHA PoW is in flight. Seeds from the live
 * count on mount (in case a solve began before this component subscribed) and
 * tracks the store thereafter.
 */
export function useAltchaBusy(): boolean {
  const [busy, setBusy] = useState<boolean>(false);
  useEffect(() => {
    setBusy(count > 0);
    return subscribe(setBusy);
  }, []);
  return busy;
}
