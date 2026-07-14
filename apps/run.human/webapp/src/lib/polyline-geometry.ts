/**
 * Pure map geometry for the PolylineRenderer (LDBR-09, Phase 52).
 *
 * A verbatim port of the bounds → zoom → center-tile math inside DC33's
 * `components/routes/PolylineRenderer.tsx`, extracted into a standalone module so
 * it is unit-testable with NO canvas/DOM/fetch. The renderer consumes this seam
 * (computeBounds + centerTile) and keeps only the imperative canvas drawing.
 *
 * DC34 delta: the input is already an array of `{ lat, lng }` OBJECTS (from
 * `Accomplishment.metadata.polyline`, produced in Phase 50), so DC33's Google
 * `decodePolyline` / `parseGPX` are intentionally NOT ported here.
 *
 * Zero side effects — safe to import in a Node vitest run.
 */

export type LatLng = { lat: number; lng: number };

export type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type Tile = { x: number; y: number };

export type CenterTile = { zoom: number; x: number; y: number };

/**
 * Bounding box covering every point, or null for an empty array so the caller
 * can early-out (draw "No route data") without an Infinity-seeded box.
 */
export function computeBounds(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const { lat, lng } of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Slippy-map tile coordinate for a lat/lng at a zoom (DC33 formula, floored).
 *   x = floor((lng + 180) / 360 * 2^zoom)
 *   y from the Web-Mercator log/tan projection.
 */
export function latLngToTile(lat: number, lng: number, zoom: number): Tile {
  const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const y = Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
      Math.pow(2, zoom)
  );
  return { x, y };
}

/**
 * Highest zoom (walking 15 → 10) at which the bounds span ≤ 1 tile in both x and
 * y, so the whole route fits in a single OSM tile. Falls back to zoom 12 when no
 * level in the range fits (DC33 parity).
 */
export function calculateZoomLevel(bounds: Bounds): number {
  for (let zoom = 15; zoom >= 10; zoom--) {
    const topLeft = latLngToTile(bounds.maxLat, bounds.minLng, zoom);
    const bottomRight = latLngToTile(bounds.minLat, bounds.maxLng, zoom);

    if (bottomRight.x - topLeft.x <= 1 && bottomRight.y - topLeft.y <= 1) {
      return zoom;
    }
  }
  return 12; // Fallback zoom
}

/**
 * The single tile that centers the route: the tile containing the bounds
 * midpoint at the fitted zoom. Returns { zoom, x, y } for the tile URL.
 */
export function centerTile(bounds: Bounds): CenterTile {
  const zoom = calculateZoomLevel(bounds);
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  const { x, y } = latLngToTile(centerLat, centerLng, zoom);
  return { zoom, x, y };
}
