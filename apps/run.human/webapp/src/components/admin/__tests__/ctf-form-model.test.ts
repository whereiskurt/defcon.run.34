import { describe, it, expect } from "vitest";

import { computePoints, type ScoringConfig } from "@/lib/ctf-scoring";
import {
  PRESET_IDS,
  presetToAdvanced,
  previewPoints,
  inferAnswerType,
  inferChallengeType,
  redactCtfSecrets,
  type ChallengeTypePreset,
  type LoadedCtfRecord,
} from "../ctf-form-model";

// A clock fixed INSIDE the tier window below, for deterministic active-tier parity.
const IN_TIER = Date.parse("2026-08-07T12:00:00Z");

// Config table for the preview↔judge parity proof. Includes: a declining curve
// with first-blood bonus, a single-solve (maxSolves===1) curve, and an
// active-time-tier curve whose ceiling overrides pointMax while `now` is inside.
const PARITY_CONFIGS: ScoringConfig[] = [
  { pointMax: 1000, pointFloor: 100, maxSolves: 5, firstBloodBonus: 500 },
  { pointMax: 500, pointFloor: 500, maxSolves: 1, firstBloodBonus: 0 },
  {
    pointMax: 800,
    pointFloor: 0,
    maxSolves: 10,
    firstBloodBonus: 250,
    timeTiers: [
      { from: "2026-08-07T00:00:00Z", to: "2026-08-09T00:00:00Z", ceiling: 2000 },
    ],
  },
];

describe("previewPoints — parity with the judge's computePoints", () => {
  it("returns exactly computePoints(n, config, now) across a config×n table", () => {
    for (const cfg of PARITY_CONFIGS) {
      // n from 1 (first blood) through maxSolves+1 (over-cap ⇒ 0).
      for (let n = 1; n <= cfg.maxSolves + 1; n++) {
        expect(previewPoints(cfg, n, IN_TIER)).toBe(computePoints(n, cfg, IN_TIER));
      }
    }
  });

  it("covers the named boundary cases explicitly (first-blood, floor, over-cap, active-tier)", () => {
    const cfg = PARITY_CONFIGS[0];
    // first blood (n=1) includes the bonus
    expect(previewPoints(cfg, 1, IN_TIER)).toBe(computePoints(1, cfg, IN_TIER));
    // floor solve (n=maxSolves) lands on pointFloor, no bonus
    expect(previewPoints(cfg, cfg.maxSolves, IN_TIER)).toBe(
      computePoints(cfg.maxSolves, cfg, IN_TIER),
    );
    // over the cap ⇒ 0
    expect(previewPoints(cfg, cfg.maxSolves + 1, IN_TIER)).toBe(0);
    // active tier: ceiling 2000 overrides pointMax 800 at IN_TIER
    const tierCfg = PARITY_CONFIGS[2];
    expect(previewPoints(tierCfg, 1, IN_TIER)).toBe(computePoints(1, tierCfg, IN_TIER));
  });

  it("coerces the form's string numeric fields at the boundary (===computePoints on the numeric equivalent)", () => {
    const stringCfg = {
      pointMax: "1000",
      pointFloor: "100",
      maxSolves: "5",
      firstBloodBonus: "500",
    };
    const numericCfg: ScoringConfig = {
      pointMax: 1000,
      pointFloor: 100,
      maxSolves: 5,
      firstBloodBonus: 500,
    };
    for (let n = 1; n <= 6; n++) {
      expect(previewPoints(stringCfg, n)).toBe(computePoints(n, numericCfg));
    }
  });

  it("treats blank/NaN numeric fields as 0 (mirroring the form's numOrUndef)", () => {
    const blankCfg = { pointMax: "", pointFloor: "", maxSolves: "", firstBloodBonus: "" };
    // maxSolves 0 ⇒ n=1 is over the cap ⇒ 0
    expect(previewPoints(blankCfg, 1)).toBe(0);
  });
});

describe("presetToAdvanced — challenge-type presets pre-fill Advanced knobs", () => {
  it("exhaustively enumerates the five preset ids via PRESET_IDS", () => {
    expect(PRESET_IDS).toEqual([
      "flat-points",
      "first-blood-race",
      "timed-drop",
      "easter-egg",
      "custom",
    ]);
  });

  it("returns numeric AdvancedKnobs for every non-custom preset", () => {
    for (const id of PRESET_IDS) {
      const knobs = presetToAdvanced(id);
      if (id === "custom") continue;
      // core scoring knobs are present and numeric
      expect(typeof knobs.pointMax).toBe("number");
      expect(typeof knobs.pointFloor).toBe("number");
      expect(typeof knobs.maxSolves).toBe("number");
      expect(typeof knobs.firstBloodBonus).toBe("number");
    }
  });

  it("custom is a no-op empty partial (never overwrites manual knobs)", () => {
    expect(presetToAdvanced("custom")).toEqual({});
  });

  it("first-blood-race carries the largest first-blood bonus of the presets", () => {
    const fb = presetToAdvanced("first-blood-race").firstBloodBonus ?? 0;
    for (const id of PRESET_IDS) {
      if (id === "first-blood-race" || id === "custom") continue;
      expect(fb).toBeGreaterThan(presetToAdvanced(id).firstBloodBonus ?? 0);
    }
  });
});

describe("inferAnswerType — edit-mode answer-type recovery", () => {
  it('defaults to "static" when answerType is absent', () => {
    expect(inferAnswerType({})).toBe("static");
  });

  it('returns "otp" when the record stores answerType "otp"', () => {
    expect(inferAnswerType({ answerType: "otp" })).toBe("otp");
  });

  it('returns "static" for an explicit "static"', () => {
    expect(inferAnswerType({ answerType: "static" })).toBe("static");
  });
});

describe("inferChallengeType — edit-mode challenge-type recovery", () => {
  it("round-trips every non-custom preset (preset → record → inferChallengeType === preset)", () => {
    for (const id of PRESET_IDS) {
      if (id === "custom") continue;
      const record = presetToAdvanced(id);
      expect(inferChallengeType(record)).toBe(id as ChallengeTypePreset);
    }
  });

  it('defaults to "custom" when no preset matches the stored scoring shape', () => {
    expect(
      inferChallengeType({
        pointMax: 1234,
        pointFloor: 7,
        maxSolves: 3,
        firstBloodBonus: 42,
      }),
    ).toBe("custom");
  });

  it('defaults to "custom" for an empty record', () => {
    expect(inferChallengeType({})).toBe("custom");
  });
});

describe("redactCtfSecrets — write-only-secret boundary (SC-2 / T-54-01-01)", () => {
  function fullRecord(): LoadedCtfRecord {
    return {
      challenge: "sao",
      pointMax: 1000,
      pointFloor: 100,
      maxSolves: 5,
      firstBloodBonus: 500,
      maxAttempts: 3,
      rateLimitWindow: 60,
      enabled: true,
      answerType: "otp",
      unlockAfter: "prologue",
      perPlayerIntervalHours: 24,
      perPlayerMax: 3,
      globalMax: 100,
      answerHash: "deadbeef",
      otp: { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 120, algorithm: "SHA1" },
      effect: { kind: "otp-enroll", otpauth: "otpauth://totp/x", nextFlag: "day2" },
    };
  }

  it("strips otp.secret and the entire effect, preserves the OTP summary fields", () => {
    const out = redactCtfSecrets(fullRecord());
    // secret is gone; the read-only OTP summary survives
    expect(out.otp).toBeDefined();
    expect((out.otp as Record<string, unknown>).secret).toBeUndefined();
    expect(out.otp?.digits).toBe(6);
    expect(out.otp?.period).toBe(120);
    expect(out.otp?.algorithm).toBe("SHA1");
    // effect never round-trips to the client
    expect((out as Record<string, unknown>).effect).toBeUndefined();
    // presence booleans surface what the form needs to render its hints
    expect(out.hasOtpSecret).toBe(true);
    expect(out.hasEffect).toBe(true);
  });

  it("does NOT mutate the input record (secret + effect still present after the call)", () => {
    const input = fullRecord();
    redactCtfSecrets(input);
    expect(input.otp?.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(input.effect).toBeDefined();
  });

  it("keeps the non-secret scoring + limit fields intact", () => {
    const out = redactCtfSecrets(fullRecord());
    expect(out.pointMax).toBe(1000);
    expect(out.pointFloor).toBe(100);
    expect(out.maxSolves).toBe(5);
    expect(out.firstBloodBonus).toBe(500);
    expect(out.maxAttempts).toBe(3);
    expect(out.rateLimitWindow).toBe(60);
    expect(out.answerType).toBe("otp");
    expect(out.unlockAfter).toBe("prologue");
    expect(out.perPlayerIntervalHours).toBe(24);
    expect(out.perPlayerMax).toBe(3);
    expect(out.globalMax).toBe(100);
    expect(out.answerHash).toBe("deadbeef");
    expect(out.enabled).toBe(true);
  });

  it("a plain static record (no otp / no effect) yields both booleans false", () => {
    const out = redactCtfSecrets({
      challenge: "plain",
      pointMax: 500,
      maxSolves: 10,
      answerType: "static",
    });
    expect(out.hasOtpSecret).toBe(false);
    expect(out.hasEffect).toBe(false);
    expect(out.otp).toBeUndefined();
    expect(out.pointMax).toBe(500);
    expect(out.maxSolves).toBe(10);
  });

  it("treats an empty-string otp.secret as absent (hasOtpSecret false)", () => {
    const out = redactCtfSecrets({
      challenge: "empty-secret",
      otp: { secret: "", digits: 6, period: 30, algorithm: "SHA1" },
    });
    expect(out.hasOtpSecret).toBe(false);
    // the summary fields still round-trip even when the secret is blank
    expect(out.otp?.digits).toBe(6);
  });
});
