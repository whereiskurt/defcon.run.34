/**
 * buildTiles — pure tile-selection logic for SocialQRRow (no React, no DOM, no
 * async QR encode) so presence/kind/order is unit-testable in isolation.
 *
 * A tile is included ONLY when its source is a non-empty (trimmed) string:
 *   - Strava / Signal are outbound-link tiles (their QR is generated in-browser
 *     from the URL, and the tile is tap-to-open).
 *   - Runner is a display-only image tile backed by the pre-generated `eqr`.
 * Order is always Strava, Signal, Runner.
 */

export interface SocialQRRowProps {
  stravaUrl?: string;
  signalUrl?: string;
  runnerQr?: string;
}

export type Tile =
  | { kind: "link"; label: string; url: string }
  | { kind: "image"; label: string; src: string };

const present = (s?: string): s is string => typeof s === "string" && s.trim().length > 0;

export function buildTiles({ stravaUrl, signalUrl, runnerQr }: SocialQRRowProps): Tile[] {
  const tiles: Tile[] = [];
  if (present(stravaUrl)) tiles.push({ kind: "link", label: "Strava", url: stravaUrl });
  if (present(signalUrl)) tiles.push({ kind: "link", label: "Signal", url: signalUrl });
  if (present(runnerQr)) tiles.push({ kind: "image", label: "Runner", src: runnerQr });
  return tiles;
}
