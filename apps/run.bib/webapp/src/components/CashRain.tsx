"use client";

import { useEffect, useMemo, useState } from "react";
import { DC34_DOLLAR_DATA_URI } from "./dc34-dollar";

/**
 * CashRain (Kurt 2026-07-03: "make it rain").
 *
 * When the runner pledges to contribute in person, USD bills rain down over
 * the bib preview and pile up filling the box. Overlay only — pointer-events
 * none — so the form underneath still works. Purely decorative; degrades to
 * nothing if unsupported.
 *
 * Mounted-guarded so the random layout is generated client-side only (no SSR
 * hydration mismatch). Bills settle via `animation-fill-mode: both`.
 */
const BILL_COUNT = 160;

interface Bill {
  key: number;
  x: number; // left %
  ty: number; // settle top %
  size: number; // bill width px (height = size/2)
  r0: number; // start rotation
  r1: number; // settle rotation
  dur: number; // fall seconds
  delay: number; // stagger seconds
}

export function CashRain({ active }: { active: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const bills = useMemo<Bill[]>(
    () =>
      Array.from({ length: BILL_COUNT }, (_, i) => ({
        key: i,
        x: Math.random() * 90,
        ty: 2 + Math.random() * 86,
        size: 34 + Math.random() * 34,
        r0: Math.random() * 720 - 360,
        r1: Math.random() * 70 - 35,
        dur: 0.8 + Math.random() * 1.2,
        delay: Math.random() * 1.4,
      })),
    []
  );

  if (!active || !mounted) return null;

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
              top: `${b.ty}%`,
              width: `${b.size}px`,
              height: `${b.size * 0.436}px`,
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
