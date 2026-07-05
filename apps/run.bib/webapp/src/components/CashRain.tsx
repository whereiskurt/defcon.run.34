"use client";

import { useEffect, useMemo, useState } from "react";
import { DC34_DOLLAR_DATA_URI } from "./dc34-dollar";

/**
 * CashRain (Kurt 2026-07-03 "make it rain"; 2026-07-05 keep it raining ~60s).
 *
 * When the runner pledges to contribute in person, USD bills pour down over the
 * bib preview AND the now-disabled Sponsor tile. Overlay only — pointer-events
 * none — so anything underneath still works. Purely decorative; degrades to
 * nothing if unsupported or when the viewer prefers reduced motion.
 *
 * Each bill loops a continuous top→bottom fall (CSS `infinite`) so the rain
 * keeps going instead of settling after one burst. The whole downpour is capped
 * at RAIN_DURATION_MS (~60s): a timer arms whenever `active` flips on and
 * unmounts the bills when it elapses, so nothing animates forever.
 *
 * Mounted-guarded so the random layout is generated client-side only (no SSR
 * hydration mismatch).
 */
const BILL_COUNT = 160;
const RAIN_DURATION_MS = 60_000; // keep it raining ~60s, then stop (Kurt 2026-07-05)

interface Bill {
  key: number;
  x: number; // left %
  size: number; // bill width px (height = size * 0.436)
  fall: number; // travel distance px (starts above → ends below the box)
  r0: number; // start rotation
  r1: number; // end rotation (loop-boundary snap is masked by opacity 0)
  dur: number; // one fall, seconds
  delay: number; // initial stagger, seconds
}

export function CashRain({ active }: { active: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => setMounted(true), []);

  // Arm a fresh ~60s downpour every time `active` flips on; clear it (and the
  // expired flag) when it flips off so a re-pledge rains again from the top.
  useEffect(() => {
    if (!active) {
      setExpired(false);
      return;
    }
    setExpired(false);
    const t = setTimeout(() => setExpired(true), RAIN_DURATION_MS);
    return () => clearTimeout(t);
  }, [active]);

  const bills = useMemo<Bill[]>(
    () =>
      Array.from({ length: BILL_COUNT }, (_, i) => {
        const dur = 1.3 + Math.random() * 1.8;
        return {
          key: i,
          x: Math.random() * 96,
          size: 30 + Math.random() * 38,
          fall: 820 + Math.random() * 240,
          r0: Math.random() * 360 - 180,
          r1: Math.random() * 360 - 180,
          dur,
          // NEGATIVE delay → each bill starts already partway through its fall,
          // so the box is full of cash on the very first frame ("explodes" into
          // a downpour) instead of queueing in from the top edge, then loops.
          delay: -Math.random() * dur,
        };
      }),
    []
  );

  if (!active || !mounted || expired) return null;

  return (
    <div
      className="cash-rain"
      aria-hidden="true"
      style={
        { "--bill": `url("${DC34_DOLLAR_DATA_URI}")` } as React.CSSProperties
      }
    >
      {bills.map((b) => (
        <span
          key={b.key}
          className="cash-bill"
          style={
            {
              left: `${b.x}%`,
              top: 0,
              width: `${b.size}px`,
              height: `${b.size * 0.436}px`,
              "--fall": `${b.fall}px`,
              "--r0": `${b.r0}deg`,
              "--r1": `${b.r1}deg`,
              "--dur": `${b.dur}s`,
              "--delay": `${b.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export default CashRain;
