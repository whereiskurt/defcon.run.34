import dumpsterFire from "@public/dumpster-fire.gif";

/**
 * BurningBib (Kurt 2026-07-05: "🔥 Fuck your bib").
 *
 * The opt-out. When the runner torches their bib, GetYourBib replaces the whole
 * name form + preview with just the animated dumpster-fire GIF — no text.
 *
 * The GIF is a STATIC IMPORT (`@public/dumpster-fire.gif`), the same reliable
 * pattern run.human uses for its header logo: Next fingerprints the asset into
 * `_next/static/media/…` (synced to S3 / served via the CDN assetPrefix), so it
 * gets a correct hashed URL and loads only when this component renders — no
 * bundle bloat, and none of the raw `public/…` 404s. Plain <img> (not
 * next/image) so the animation is preserved. Scales up to ~bib-preview size.
 */
export function BurningBib() {
  return (
    <div className="burning-bib">
      <img
        className="burn-gif"
        src={dumpsterFire.src}
        alt="Your bib is a dumpster fire."
        width={dumpsterFire.width}
        height={dumpsterFire.height}
      />
    </div>
  );
}

export default BurningBib;
