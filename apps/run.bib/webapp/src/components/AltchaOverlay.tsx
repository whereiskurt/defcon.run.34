"use client";

import { Spinner } from "@heroui/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { useAltchaBusy } from "@/lib/altcha-overlay";

/**
 * AltchaOverlay (Plan 34-04, Slice B — D-09 / B-T4, UI-SPEC IC-2).
 *
 * The single global affordance for the ALTCHA proof-of-work. Mounted ONCE in
 * `app/providers.tsx` inside `HeroUIProvider`. It subscribes to the in-flight
 * counter in `lib/altcha-overlay.ts` (raised by `solveAltcha`) and, while any
 * PoW is solving, paints a dimmed + blurred, NON-DISMISSABLE full-viewport layer
 * with a centered HeroUI Spinner ("Checking you're human…"). It auto-hides the
 * instant the counter returns to 0.
 *
 * This replaces every inline "verifying / Saving…" hint (SC34.7). It is cosmetic
 * only — the PoW is still verified server-side (T-34-10); the overlay is
 * non-dismissable so it can never imply a client-side bypass.
 *
 * Motion: a ~150ms opacity fade, disabled under `prefers-reduced-motion`.
 * z-index 9999 sits above all app chrome (CashRain is z-index 5).
 */
export function AltchaOverlay() {
  const busy = useAltchaBusy();
  const reduceMotion = useReducedMotion();
  const fade = reduceMotion ? 0 : 0.15;

  return (
    <AnimatePresence>
      {busy && (
        <motion.div
          key="altcha-overlay"
          role="status"
          aria-live="polite"
          aria-busy="true"
          initial={{ opacity: reduceMotion ? 1 : 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: reduceMotion ? 1 : 0 }}
          transition={{ duration: fade }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(10,10,15,0.55)",
            // Blur everything behind the overlay (mint-tinted spinner floats above).
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <Spinner color="success" label="Checking you're human…" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default AltchaOverlay;
