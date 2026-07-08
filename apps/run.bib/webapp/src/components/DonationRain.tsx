"use client";

import { useEffect } from "react";
import { setRaining } from "@/lib/rain-store";

/**
 * DonationRain (③ 2026-07-08) — a one-shot celebratory cash rain fired when the
 * runner lands back on the bib page from a completed donation (`?status=donated`).
 *
 * It only KICKS the rain on mount; CashRain's own ~60s cap ends it. It does NOT
 * set the persistent `willPayInPerson` pledge — this is a transient celebration,
 * not the in-person pledge rain (which is driven by ContributionChoice).
 */
export function DonationRain() {
  useEffect(() => {
    setRaining(true);
  }, []);
  return null;
}

export default DonationRain;
