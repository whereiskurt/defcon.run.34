"use client";

import { useState } from "react";

/**
 * Collectible card art for the /ctf/cards board. Given a `slug` (the basic name
 * an admin typed in CtfForm's "Card image" field) it renders the matching asset
 * from public/ctf-cards/, trying <slug>.webp first, then <slug>.svg, then the
 * shared mystery placeholder — so an admin can drop EITHER format under a basic
 * name and it just works, and a typo degrades to the "?" tile instead of a
 * broken image. Client-only because the fallback needs onError.
 *
 * `base` is the region basePath (apiBase(): "" in dev, "/use1" in prod) — raw
 * <img src> is NOT auto-prefixed by Next, so it is prepended explicitly.
 */
export function CtfCardArt({
  base,
  slug,
  alt,
}: {
  base: string;
  slug: string;
  alt: string;
}) {
  const chain = [
    `${base}/ctf-cards/${slug}.webp`,
    `${base}/ctf-cards/${slug}.svg`,
    `${base}/ctf-cards/_mystery.svg`,
  ];
  const [i, setI] = useState(0);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={chain[i]}
      alt={alt}
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover"
      onError={() => setI((n) => Math.min(n + 1, chain.length - 1))}
    />
  );
}
