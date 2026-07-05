/**
 * BurningBib (Kurt 2026-07-05: "🔥 Fuck your bib").
 *
 * The dramatic opt-out. When the runner torches their bib, GetYourBib swaps the
 * name form + preview for this: an animated dumpster-fire GIF with a "R.I.P.
 * your bib" caption. The GIF is a public asset (public/dumpster-fire.gif) served
 * under the app basePath — it only downloads when actually burned, so it never
 * weighs on the normal page. Scales to the container, so it reads fine on mobile.
 */

// Public assets are served under the app basePath in prod (see map-background.tsx).
const assetBase =
  process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";

export function BurningBib() {
  return (
    <div className="burning-bib">
      <div className="burn-caption">🔥 R.I.P. your bib 🔥</div>
      <img
        className="burn-gif"
        src={`${assetBase}/dumpster-fire.gif`}
        alt="A dumpster, on fire."
        width={360}
        height={239}
      />
    </div>
  );
}

export default BurningBib;
