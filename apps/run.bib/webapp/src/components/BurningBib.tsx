import { DC34_DUMPSTER_FIRE_DATA_URI } from "./dc34-dumpster";

/**
 * BurningBib (Kurt 2026-07-05: "🔥 Fuck your bib").
 *
 * The dramatic opt-out. When the runner torches their bib, GetYourBib swaps the
 * name form + preview for this: an animated dumpster-fire GIF with a "R.I.P.
 * your bib" caption. The GIF is inlined as a data URI (dc34-dumpster.ts) — same
 * proven pattern as the other DC34 assets — so it renders regardless of
 * public-asset serving quirks. BibForm lazy-loads this component (next/dynamic)
 * so the ~220KB GIF only ships when someone actually burns. Scales to the
 * container, so it reads fine on mobile.
 */
export function BurningBib() {
  return (
    <div className="burning-bib">
      <div className="burn-caption">🔥 R.I.P. your bib 🔥</div>
      <img
        className="burn-gif"
        src={DC34_DUMPSTER_FIRE_DATA_URI}
        alt="A dumpster, on fire."
        width={280}
        height={186}
      />
    </div>
  );
}

export default BurningBib;
