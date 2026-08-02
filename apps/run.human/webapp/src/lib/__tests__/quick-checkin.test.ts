import { describe, it, expect } from "vitest";
import {
  quickCheckInCopy,
  buildQuickCheckInBody,
  quickCheckInError,
  QUICK_CHECKIN_SOURCE,
  GPS_UNAVAILABLE_MESSAGE,
} from "../quick-checkin";
import type { GpsSample } from "../gps-samples";

const SAMPLES: GpsSample[] = [
  { latitude: 36.17, longitude: -115.14, accuracy: 10, timestamp: 1 },
];

describe("quickCheckInCopy", () => {
  it("speaks privately when the runner's preference is private", () => {
    const copy = quickCheckInCopy("private");
    expect(copy.isPrivate).toBe(true);
    expect(copy.titleFallback).toBe("Fast private check-in");
    expect(copy.bodyFallback).toBe("Saved to your history only.");
    expect(copy.titleKey).toBe("checkin.quick.title.private");
    expect(copy.bodyKey).toBe("checkin.quick.body.private");
  });

  it.each([undefined, "public", "", "PRIVATE", "anything-else"])(
    "defaults to public for %p",
    (preference) => {
      const copy = quickCheckInCopy(preference);
      expect(copy.isPrivate).toBe(false);
      expect(copy.titleFallback).toBe("Fast public check-in");
      expect(copy.bodyFallback).toBe("Posts your location to the live map.");
      expect(copy.titleKey).toBe("checkin.quick.title.public");
      expect(copy.bodyKey).toBe("checkin.quick.body.public");
    },
  );
});

describe("buildQuickCheckInBody", () => {
  it("sends the samples under the quick source label", () => {
    expect(buildQuickCheckInBody(SAMPLES)).toEqual({
      samples: SAMPLES,
      source: "Web Quick",
    });
    expect(QUICK_CHECKIN_SOURCE).toBe("Web Quick");
  });

  // The whole privacy guarantee of the fast path: the route resolves
  // isPrivate and the pin from the runner's profile, so sending either
  // here would let the quick modal silently diverge from their settings.
  it("omits isPrivate, pinIcon and pinColor entirely", () => {
    const body = buildQuickCheckInBody(SAMPLES);
    expect(Object.keys(body).sort()).toEqual(["samples", "source"]);
    expect("isPrivate" in body).toBe(false);
    expect("pinIcon" in body).toBe(false);
    expect("pinColor" in body).toBe(false);
  });
});

describe("quickCheckInError", () => {
  it("names the quota on 429", () => {
    expect(quickCheckInError(429)).toBe("Check-in limit reached for today");
  });

  it.each([400, 401, 500, 503])("falls back to the generic message on %i", (status) => {
    expect(quickCheckInError(status)).toBe("Something went wrong");
  });

  it("matches the wording the full check-in modal uses for GPS failure", () => {
    expect(GPS_UNAVAILABLE_MESSAGE).toBe(
      "Location unavailable -- enable GPS and try again",
    );
  });
});
