import { describe, it, expect } from "vitest";

import {
  isRepeatable,
  scoreBucket,
  assertAnswerTypeTransition,
  mergeFlagTypeNextState,
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

// CR-01 regression: upsertCtf must feed the guard the MERGED next-state (no-clobber
// overlay of the partial edit onto the stored row), NOT the raw partial input. A
// partial edit that omits the repeatable-defining fields must not be misread as a
// static<->repeatable flip.
describe("mergeFlagTypeNextState (CR-01 no-clobber merge)", () => {
  it("preserves stored repeatable fields when the edit omits them", () => {
    // Admin edits only `points` on a solved repeatable challenge — the partial
    // input carries none of the flag-type fields.
    const existing = { answerType: "static", perPlayerMax: 3 };
    const merged = mergeFlagTypeNextState(existing, {});
    expect(merged.perPlayerMax).toBe(3);
    expect(isRepeatable(merged)).toBe(true);
  });

  it("does NOT trip the flip guard on a partial edit of a solved repeatable flag", () => {
    // The exact CR-01 break: raw partial `{}` would read as non-repeatable and
    // throw; the merged next-state stays repeatable and passes.
    const existing = { perPlayerMax: 3 };
    const merged = mergeFlagTypeNextState(existing, {});
    expect(() =>
      assertAnswerTypeTransition(existing, merged, true)
    ).not.toThrow();
  });

  it("preserves a stored otp answerType across a partial edit", () => {
    const existing = { answerType: "otp" };
    const merged = mergeFlagTypeNextState(existing, { perPlayerMax: 2 });
    expect(merged.answerType).toBe("otp");
    expect(() =>
      assertAnswerTypeTransition(existing, merged, true)
    ).not.toThrow();
  });

  it("still surfaces a GENUINE flip — explicit perPlayerMax 3->1 on a solved repeatable flag throws", () => {
    const existing = { perPlayerMax: 3 };
    const merged = mergeFlagTypeNextState(existing, { perPlayerMax: 1 });
    expect(isRepeatable(merged)).toBe(false);
    expect(() =>
      assertAnswerTypeTransition(existing, merged, true)
    ).toThrow(QrValidationError);
  });

  it("still surfaces a GENUINE flip — static -> otp on a solved static flag throws", () => {
    const existing = { answerType: "static" };
    const merged = mergeFlagTypeNextState(existing, { answerType: "otp" });
    expect(() =>
      assertAnswerTypeTransition(existing, merged, true)
    ).toThrow(QrValidationError);
  });

  it("overlays a provided falsy-but-defined field (perPlayerIntervalHours: 0) without clobbering to stored", () => {
    // `0` is a real provided value under the `!== undefined` no-clobber contract;
    // `??` keeps it (only null/undefined fall back).
    const existing = { perPlayerIntervalHours: 24 };
    const merged = mergeFlagTypeNextState(existing, { perPlayerIntervalHours: 0 });
    expect(merged.perPlayerIntervalHours).toBe(0);
  });
});
