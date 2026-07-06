"use client";

import { useEffect, useState } from "react";
import { getRaining, subscribe } from "@/lib/rain-store";
import { useCopy } from "@/components/CopyProvider";

/**
 * PledgeTagline (Kurt 2026-07-05).
 *
 * The prominent green line above the tiles. Driven by the rain-store (raining ==
 * "I'll give $20 in person") so it updates INSTANTLY with the choice and doesn't
 * need a server round-trip:
 *   - in person → the pledge tagline (bib.status.pledgeTagline via useCopy)
 *   - burned / nothing → renders nothing.
 * Seeded from the server-side pledge (initialRaining) so a persisted pledge shows
 * it on load too.
 */
export function PledgeTagline({ initialRaining }: { initialRaining: boolean }) {
  const { t } = useCopy();
  const [raining, setRaining] = useState<boolean>(initialRaining);
  useEffect(() => {
    setRaining((prev) => prev || getRaining());
    return subscribe(setRaining);
  }, []);

  if (!raining) return null;

  return (
    <p
      style={{
        margin: 0,
        textAlign: "center",
        color: "#7fdc9e",
        fontSize: 24,
        fontWeight: 800,
        letterSpacing: "0.01em",
      }}
    >
      {t("bib.status.pledgeTagline")}
    </p>
  );
}

export default PledgeTagline;
