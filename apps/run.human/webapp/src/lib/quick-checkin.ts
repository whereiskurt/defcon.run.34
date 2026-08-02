import type { GpsSample } from "./gps-samples";

/**
 * Decisions behind the one-tap check-in, kept out of the component so they
 * can be asserted (this app tests in the node environment only).
 */

/** Distinct from 'Web GPS' and 'Admin Manual' so fast-path use is measurable. */
export const QUICK_CHECKIN_SOURCE = "Web Quick";

/** Same wording the full check-in modal uses, so the two speak with one voice. */
export const GPS_UNAVAILABLE_MESSAGE =
  "Location unavailable -- enable GPS and try again";

export interface QuickCheckInCopy {
  isPrivate: boolean;
  titleKey: string;
  titleFallback: string;
  bodyKey: string;
  bodyFallback: string;
}

/**
 * The quick modal has no privacy toggle, so it must say plainly which kind of
 * check-in the button will make. Only an exact 'private' counts -- the same
 * comparison the check-ins route makes when it resolves the default.
 */
export function quickCheckInCopy(preference?: string): QuickCheckInCopy {
  const isPrivate = preference === "private";
  return isPrivate
    ? {
        isPrivate,
        titleKey: "checkin.quick.title.private",
        titleFallback: "Fast private check-in",
        bodyKey: "checkin.quick.body.private",
        bodyFallback: "Saved to your history only.",
      }
    : {
        isPrivate,
        titleKey: "checkin.quick.title.public",
        titleFallback: "Fast public check-in",
        bodyKey: "checkin.quick.body.public",
        bodyFallback: "Posts your location to the live map.",
      };
}

/**
 * Deliberately carries no isPrivate and no pin: POST /api/checkins already
 * falls back to the runner's preference and profile pin, so omitting them is
 * what keeps the fast path honest.
 */
export function buildQuickCheckInBody(samples: GpsSample[]): {
  samples: GpsSample[];
  source: string;
} {
  return { samples, source: QUICK_CHECKIN_SOURCE };
}

export function quickCheckInError(status: number): string {
  return status === 429
    ? "Check-in limit reached for today"
    : "Something went wrong";
}
