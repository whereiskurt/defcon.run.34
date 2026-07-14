"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * CtfCelebration — the DC33-style award payoff for a covert CTF win.
 *
 * Ported from run.bib's CashRain lineage: an `active`-gated overlay that is
 * pointer-events:none (never blocks the UI underneath), mounted-guarded (random
 * layout generated client-side only, no SSR hydration mismatch), and
 * self-terminating — a bounded timer arms when `active` flips on and clears the
 * pieces when it elapses, so nothing animates forever. Self-contained: the
 * confetti are small DC34-palette (mint-teal + magenta) colored spans placed by
 * randomized CSS custom properties, so the module needs no image asset.
 *
 * Its keyframes (globals.css) are deliberately NOT under a reduced-motion
 * suppression rule — this is a user-INITIATED celebration, so a viewer with
 * Reduce Motion on still sees their win (the documented prod cash-rain lesson).
 */
const PIECE_COUNT = 90;
const BURST_DURATION_MS = 4200; // one confetti burst, then stop
const COLORS = ["#00d4aa", "#ff2fb9", "#ff5c72", "#5eead4", "#ffd700"];

interface Piece {
  key: number;
  x: number; // left %
  w: number; // width px (height = w * 0.5)
  fall: number; // travel distance px
  r0: number; // start rotation
  r1: number; // end rotation (negative delay below → instant burst fill)
  dur: number; // one fall, seconds
  delay: number;
  color: string;
}

export function CtfCelebration({ active }: { active: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => setMounted(true), []);

  // Arm a fresh bounded burst every time `active` flips on; clear it (and the
  // expired flag) when it flips off so a re-trigger celebrates again.
  useEffect(() => {
    if (!active) {
      setExpired(false);
      return;
    }
    setExpired(false);
    const t = setTimeout(() => setExpired(true), BURST_DURATION_MS);
    return () => clearTimeout(t);
  }, [active]);

  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: PIECE_COUNT }, (_, i) => {
        const dur = 2.2 + Math.random() * 1.4;
        return {
          key: i,
          x: Math.random() * 98,
          w: 7 + Math.random() * 9,
          fall: 640 + Math.random() * 420,
          r0: Math.random() * 360 - 180,
          r1: Math.random() * 720 - 360,
          dur,
          delay: -Math.random() * 0.6, // negative → fills on frame 1 (bursts)
          color: COLORS[i % COLORS.length],
        };
      }),
    []
  );
  if (!active || !mounted || expired) return null;

  return (
    <div className="ctf-celebration" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.key}
          className="ctf-confetti"
          style={
            {
              left: `${p.x}%`,
              top: 0,
              width: `${p.w}px`,
              height: `${p.w * 0.5}px`,
              backgroundColor: p.color,
              "--fall": `${p.fall}px`,
              "--r0": `${p.r0}deg`,
              "--r1": `${p.r1}deg`,
              "--dur": `${p.dur}s`,
              "--delay": `${p.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export default CtfCelebration;
