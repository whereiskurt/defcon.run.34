/**
 * Pure parts of the GPS check-in sampling loop, split out from the React hook
 * so they are testable in the node environment (this app has no jsdom).
 */

export interface GpsSample {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

/** Samples averaged into one check-in. */
export const SAMPLE_TARGET = 3;

/** Gap between samples -- three fixes land in roughly two seconds. */
export const SAMPLE_INTERVAL_MS = 667;

export const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
};

export function toGpsSample(position: GeolocationPosition, now: number): GpsSample {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: now,
  };
}

/** Tightest fix in the batch, or null when nothing has landed yet. */
export function bestAccuracyOf(samples: GpsSample[]): number | null {
  if (samples.length === 0) return null;
  return Math.min(...samples.map((s) => s.accuracy));
}
