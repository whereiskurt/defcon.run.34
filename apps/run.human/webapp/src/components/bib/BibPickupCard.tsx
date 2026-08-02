"use client";

import BibPreview from "./BibPreview";

/**
 * BibPickupCard — the payoff screen for a runner's FIRST self-scan.
 *
 * The workflow it serves: a runner turns up at the pickup table, says their
 * bib, a volunteer shows it to them, and then they scan it. Seeing THIS screen
 * is what tells the volunteer the bib is really theirs — so the render has to
 * be the actual bib (ported `BibPreview`), not an approximation. Recognising it
 * IS the verification.
 *
 * Purely presentational: the award already happened server-side before this
 * ever renders (see lib/bib-pickup.ts).
 */
export default function BibPickupCard({
  nameOnBib,
  runnerCode,
  hasSponsored,
  points,
  title,
  subtitle,
}: {
  nameOnBib: string;
  runnerCode: string;
  hasSponsored: boolean;
  points: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <p className="text-4xl leading-none">🎉</p>
      <h2 className="font-museo text-2xl font-bold text-foreground text-center">
        {title}
      </h2>
      <p className="text-sm text-default-500 text-center max-w-xs">{subtitle}</p>

      {/* The bib itself. max-w keeps the 1000-wide SVG readable on a phone,
          which is the only device this screen is ever seen on. */}
      <div className="w-full max-w-[420px]">
        <BibPreview
          name={nameOnBib}
          runnerCode={runnerCode}
          hasSponsored={hasSponsored}
        />
      </div>

      {points > 0 && (
        <p className="font-museo text-xl font-bold text-primary">
          +{points} 🥕
        </p>
      )}
    </div>
  );
}
