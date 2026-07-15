import { describe, it, expect } from "vitest";

import {
  isRepeatable,
  scoreBucket,
  assertAnswerTypeTransition,
} from "@/lib/ctf-flag-types";
import { QrValidationError } from "@/lib/qr-errors";

/**
 * Unit proof for the pure flag-types helpers (Slice 1a). No I/O, no electro:
 * these are structurally-typed pure functions the judge (53-03) and the write
 * guard (qr-admin.upsertCtf) consume.
 */

describe("isRepeatable", () => {
  it("is false for a plain static row (no gating fields)", () => {
    expect(isRepeatable({})).toBe(false);
    expect(isRepeatable({ answerType: "static" })).toBe(false);
  });

  it("is true when answerType is otp", () => {
    expect(isRepeatable({ answerType: "otp" })).toBe(true);
  });

  it("is true when perPlayerMax > 1", () => {
    expect(isRepeatable({ perPlayerMax: 2 })).toBe(true);
  });

  it("is false when perPlayerMax is 1 (single award)", () => {
    expect(isRepeatable({ perPlayerMax: 1 })).toBe(false);
  });

  it("is true when perPlayerIntervalHours is set (>0)", () => {
    expect(isRepeatable({ perPlayerIntervalHours: 24 })).toBe(true);
  });

  it("is false when perPlayerIntervalHours is 0", () => {
    expect(isRepeatable({ perPlayerIntervalHours: 0 })).toBe(false);
  });
});

describe("scoreBucket", () => {
  const base = Date.UTC(2026, 6, 15, 6, 0, 0); // 2026-07-15T06:00:00Z

  it("returns the SAME token for two times in the same 24h window", () => {
    const a = scoreBucket(base, { perPlayerIntervalHours: 24 });
    const b = scoreBucket(base + 5 * 3600 * 1000, { perPlayerIntervalHours: 24 });
    expect(a).toBe(b);
  });

  it("returns a DIFFERENT token for the adjacent 24h window", () => {
    const a = scoreBucket(base, { perPlayerIntervalHours: 24 });
    const next = scoreBucket(base + 24 * 3600 * 1000, {
      perPlayerIntervalHours: 24,
    });
    expect(a).not.toBe(next);
  });

  it("buckets by the OTP period (120s) when no interval is given", () => {
    const a = scoreBucket(base, { otpPeriodSeconds: 120 });
    const same = scoreBucket(base + 119 * 1000, { otpPeriodSeconds: 120 });
    const next = scoreBucket(base + 120 * 1000, { otpPeriodSeconds: 120 });
    expect(a).toBe(same);
    expect(a).not.toBe(next);
  });

  it("prefers the interval over the OTP period when both are given", () => {
    // 24h interval dominates: a 120s step stays in the same bucket.
    const a = scoreBucket(base, {
      perPlayerIntervalHours: 24,
      otpPeriodSeconds: 120,
    });
    const b = scoreBucket(base + 120 * 1000, {
      perPlayerIntervalHours: 24,
      otpPeriodSeconds: 120,
    });
    expect(a).toBe(b);
  });
});

describe("assertAnswerTypeTransition", () => {
  it("throws when flipping static -> repeatable with solves", () => {
    expect(() =>
      assertAnswerTypeTransition({ answerType: "static" }, { answerType: "otp" }, true)
    ).toThrow(QrValidationError);
  });

  it("throws when flipping repeatable -> static with solves", () => {
    expect(() =>
      assertAnswerTypeTransition({ answerType: "otp" }, { answerType: "static" }, true)
    ).toThrow(QrValidationError);
  });

  it("also catches a perPlayerMax-driven repeatable flip with solves", () => {
    expect(() =>
      assertAnswerTypeTransition({}, { perPlayerMax: 3 }, true)
    ).toThrow(QrValidationError);
  });

  it("is a no-op when there are no solves (flip allowed)", () => {
    expect(() =>
      assertAnswerTypeTransition({ answerType: "static" }, { answerType: "otp" }, false)
    ).not.toThrow();
  });

  it("is a no-op when repeatable-ness is unchanged (static -> static)", () => {
    expect(() =>
      assertAnswerTypeTransition({ answerType: "static" }, { answerType: "static" }, true)
    ).not.toThrow();
  });

  it("is a no-op when repeatable-ness is unchanged (repeatable -> repeatable)", () => {
    expect(() =>
      assertAnswerTypeTransition(
        { answerType: "otp" },
        { perPlayerMax: 5 },
        true
      )
    ).not.toThrow();
  });
});
