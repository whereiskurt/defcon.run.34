"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

import { CtfCelebration } from "@/components/CtfCelebration";
import { fireEgg, claimStashed, trimBurst } from "@/lib/covert-egg";

/**
 * EggTrigger — the `!!!` easter-egg listener that wires the full covert loop
 * (CTF-09). Headless: it renders only the CtfCelebration overlay (pointer-events
 * none), so it can be dropped into any layout/page without disturbing chrome.
 *
 * Gesture: three `!` characters typed in quick succession, OR a triple-tap on
 * touch — both within a short rolling window. On trigger it fires the baked demo
 * flag through the covert endpoint; a computed-style win toggles the celebration.
 *
 * Deferred claim (SC2): on MOUNT it calls claimStashed, so any flag parked while
 * unauthenticated is re-fired through the covert endpoint the moment the user
 * next loads a signed-in page — crediting idempotently via judgeSolve. This is
 * the load-bearing park-and-claim path (NOT a server-returned nonce).
 */

// The baked demo challenge + guess for the in-app `!!!` payoff loop. A known
// covert challenge whose answer is the egg gesture itself, so a signed-in player
// firing `!!!` on any protected page drives trigger → covert → credit → confetti.
const DEMO_CHALLENGE = "dc34-egg";
const DEMO_GUESS = "!!!";

const GESTURE_WINDOW_MS = 1200; // rolling window for the 3 hits
const CLEAR_MS = 5000; // auto-clear so a later trigger can re-fire
// Mobile has no keyboard for "!!!" — 5 fast theme flips (dark/light/dark…) fire too.
const THEME_FLIP_WINDOW_MS = 2000;
const THEME_FLIP_COUNT = 5;

export function EggTrigger() {
  const { resolvedTheme } = useTheme();
  const [celebrating, setCelebrating] = useState(false);
  const keyHits = useRef<number[]>([]);
  const tapHits = useRef<number[]>([]);
  const themeHits = useRef<number[]>([]);
  const prevTheme = useRef<string | undefined>(undefined);

  // Fire the covert egg + celebrate on a win. Shared by every trigger below.
  const fire = useCallback(() => {
    fireEgg(DEMO_CHALLENGE, DEMO_GUESS, (win) => {
      if (win) setCelebrating(true);
    });
  }, []);

  // Redeem any flag parked while unauthenticated, on the next signed-in load.
  useEffect(() => {
    claimStashed(() => setCelebrating(true));
  }, []);

  // Bounded celebration so a subsequent `!!!` can celebrate again.
  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(false), CLEAR_MS);
    return () => clearTimeout(t);
  }, [celebrating]);

  useEffect(() => {
    const record = (buf: React.MutableRefObject<number[]>): boolean => {
      buf.current = trimBurst(buf.current, Date.now(), GESTURE_WINDOW_MS);
      if (buf.current.length >= 3) {
        buf.current = [];
        return true;
      }
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "!") {
        keyHits.current = [];
        return;
      }
      if (record(keyHits)) fire();
    };
    const onTouch = () => {
      if (record(tapHits)) fire();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("touchend", onTouch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchend", onTouch);
    };
  }, [fire]);

  // Mobile trigger: 5 fast theme flips (dark/light/dark/light/dark). next-themes
  // updates resolvedTheme on each toggle, so we count genuine changes in a window.
  useEffect(() => {
    if (resolvedTheme === undefined) return;
    if (prevTheme.current === undefined) {
      prevTheme.current = resolvedTheme; // the first resolved value is not a "flip"
      return;
    }
    if (resolvedTheme === prevTheme.current) return; // not an actual change
    prevTheme.current = resolvedTheme;
    themeHits.current = trimBurst(themeHits.current, Date.now(), THEME_FLIP_WINDOW_MS);
    if (themeHits.current.length >= THEME_FLIP_COUNT) {
      themeHits.current = [];
      fire();
    }
  }, [resolvedTheme, fire]);

  return <CtfCelebration active={celebrating} />;
}

export default EggTrigger;
