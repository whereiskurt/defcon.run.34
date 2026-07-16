// apps/run.gpx/gpx-studio/website/src/lib/components/map/rabbit-svg.ts
/**
 * One rabbit silhouette for the whole rabbit layer, tinted by the runner's
 * pinColor. Same shape for real + sim rabbits = camouflage; color = identity.
 * viewBox 0 0 24 24, bottom-anchored (feet at y≈23) like the branded map-pin.
 */
export function rabbitSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <ellipse cx="9.4" cy="6.5" rx="1.5" ry="4" fill="${color}" stroke="#101015" stroke-width="0.6"/>
    <ellipse cx="14.6" cy="6.5" rx="1.5" ry="4" fill="${color}" stroke="#101015" stroke-width="0.6"/>
    <path d="M6.5 15c0-3 2.5-5 5.5-5s5.5 2 5.5 5c0 3-2.2 5.5-5.5 7.5C8.7 20.5 6.5 18 6.5 15z"
          fill="${color}" stroke="#101015" stroke-width="0.7"/>
    <circle cx="10.3" cy="14" r="0.9" fill="#101015"/>
    <circle cx="13.7" cy="14" r="0.9" fill="#101015"/>
  </svg>`;
}
