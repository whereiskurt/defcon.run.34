/**
 * runHumanUrl — the single region-prefix helper for every cross-app link from
 * run.bib into run.defcon.run (run.human).
 *
 * run.defcon.run is mounted under /{region} (CloudFront routes /{region}/*), so
 * a region-less URL misroutes. Every cross-app link — the dropdown's Profile /
 * GPS Check-in / Show My QR items and the header + mobile-menu Meshtastic link —
 * routes through here so the region prefix is applied consistently, matching
 * flash's RUN_BASE convention.
 *
 * The host is hardcoded to run.defcon.run (identical to flash's RUN_BASE and to
 * bib's existing header external links). The region is read at CALL time from
 * NEXT_PUBLIC_REGION_SHORT (baked into the client bundle) — mirroring
 * social-qr.ts's call-time env read so vi.stubEnv works in tests — defaulting to
 * use1 when unset. This is a plain module with NO react/heroui imports so the
 * node-env vitest can import it directly.
 */
export function runHumanUrl(path: string): string {
  const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
  return `https://run.defcon.run/${region}${path}`;
}

export default runHumanUrl;
