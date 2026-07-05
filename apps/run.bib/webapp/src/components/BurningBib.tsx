import { DC34_DUMPSTER_FIRE_DATA_URI } from "./dc34-dumpster";

/**
 * BurningBib (Kurt 2026-07-05: "🔥 Fuck your bib").
 *
 * The opt-out. When the runner torches their bib, GetYourBib replaces the whole
 * name form + preview with just the animated dumpster-fire GIF and a small
 * "boom! dumpster fire" overlay — no header. The GIF is inlined as a data URI
 * (dc34-dumpster.ts, same pattern as the other DC34 assets) so it renders with
 * no dependency on public-asset serving / lazy chunk loading. Scales to the
 * container so it reads on mobile.
 */
export function BurningBib() {
  return (
    <div className="burning-bib">
      <img
        className="burn-gif"
        src={DC34_DUMPSTER_FIRE_DATA_URI}
        alt="Your bib is a dumpster fire."
        width={280}
        height={186}
      />
      <span className="burn-overlay">boom! 🔥 dumpster fire</span>
    </div>
  );
}

export default BurningBib;
