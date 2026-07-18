import { describe, it, expect } from "vitest";

import { computePoints, type ScoringConfig } from "@/lib/ctf-scoring";
import {
  PRESET_IDS,
  presetToAdvanced,
  previewPoints,
  inferAnswerType,
  inferChallengeType,
  redactCtfSecrets,
  buildOtpAnswerField,
  formStateToScoreWindow,
  scoreWindowToFormState,
  type ChallengeTypePreset,
  type LoadedCtfRecord,
  type ScoreWindowFormState,
} from "../ctf-form-model";
import { base32Decode } from "@/lib/ctf-otp-core";
import { DEFCON_RUN_HOURS, type ScoreWindow } from "@/lib/ctf-score-window";

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

  it('returns "wordlist" when the record stores answerType "wordlist" (Slice 3)', () => {
    expect(inferAnswerType({ answerType: "wordlist" })).toBe("wordlist");
  });

  it('falls back to "static" for an unknown answerType value', () => {
    expect(inferAnswerType({ answerType: "bogus" })).toBe("static");
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
      otp: { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 120, algorithm: "SHA1", singleUse: true },
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
    // singleUse is non-secret — preserved so the edit form rehydrates the toggle (Phase 65)
    expect(out.otp?.singleUse).toBe(true);
    // effect never round-trips to the client
    expect((out as unknown as Record<string, unknown>).effect).toBeUndefined();
    // presence booleans surface what the form needs to render its hints
    expect(out.hasOtpSecret).toBe(true);
    expect(out.hasEffect).toBe(true);
  });

  it("preserves otp.singleUse === undefined (default-off) through redaction", () => {
    const rec = fullRecord();
    rec.otp = { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 120, algorithm: "SHA1" };
    const out = redactCtfSecrets(rec);
    expect(out.otp?.singleUse).toBeUndefined();
    expect((out.otp as Record<string, unknown>).secret).toBeUndefined();
    expect(out.hasOtpSecret).toBe(true);
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

describe("buildOtpAnswerField — Rotating-OTP answer parse (CR-01)", () => {
  // The whole point of CR-01: the stored secret must be a base32 string the
  // judge's base32Decode can consume, NOT the raw otpauth:// URL.
  it("extracts a base32 secret (decodable, no ':' or '/') from an otpauth:// URL", () => {
    const url = "otpauth://totp/Defcon.run:runner?secret=JBSWY3DPEHPK3PXP&issuer=Defcon.run";
    const field = buildOtpAnswerField(url);
    expect(field.secret).toBe("JBSWY3DPEHPK3PXP");
    // The regression guard: the old code stored the raw URL, which base32Decode
    // throws on. The parsed secret must decode without throwing.
    expect(() => base32Decode(field.secret)).not.toThrow();
    expect(field.secret).not.toContain(":");
    expect(field.secret).not.toContain("/");
  });

  it("carries the URL's digits/period through instead of silently defaulting", () => {
    const url =
      "otpauth://totp/Defcon.run:runner?secret=JBSWY3DPEHPK3PXP&digits=8&period=30";
    const field = buildOtpAnswerField(url);
    expect(field.digits).toBe(8);
    expect(field.period).toBe(30);
  });

  it("applies the meshtk defaults (6 digits / 120s) when the URL omits them", () => {
    const field = buildOtpAnswerField(
      "otpauth://totp/Defcon.run:runner?secret=JBSWY3DPEHPK3PXP",
    );
    expect(field.digits).toBe(6);
    expect(field.period).toBe(120);
  });

  it("the parsed secret equals the same base32 the reward side enrolls (chained flow)", () => {
    // A reward hands out this exact otpauth:// URL; the downstream Rotating-OTP
    // flag must verify codes from the SAME base32 secret — proving the two sides
    // agree (the CR-01 chained-flow invariant).
    const seed = "otpauth://totp/Defcon.run:day2?secret=GEZDGNBVGY3TQOJQ&period=120";
    expect(buildOtpAnswerField(seed).secret).toBe("GEZDGNBVGY3TQOJQ");
  });

  it("throws on a bare base32 secret (not an otpauth:// URL)", () => {
    expect(() => buildOtpAnswerField("JBSWY3DPEHPK3PXP")).toThrow();
  });

  it("throws on a non-otpauth URL", () => {
    expect(() => buildOtpAnswerField("https://example.com/?secret=JBSWY3DPEHPK3PXP")).toThrow();
  });

  it("throws on an otpauth URL missing the secret", () => {
    expect(() => buildOtpAnswerField("otpauth://totp/Defcon.run:x")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scoring-window form-state bridge (Slice 2, CTFT-09/11)
// ---------------------------------------------------------------------------

describe("formStateToScoreWindow — form state → persisted ScoreWindow | undefined", () => {
  it("returns undefined when the enable flag is off (nothing persisted ⇒ always-open)", () => {
    const off: ScoreWindowFormState = {
      enabled: false,
      days: [0, 4, 5, 6],
      from: "06:00",
      to: "08:00",
      tzLabel: "PT",
    };
    expect(formStateToScoreWindow(off)).toBeUndefined();
  });

  it("maps the PT/ET/UTC label to its IANA id and returns {days, from, to, tz}", () => {
    const pt: ScoreWindowFormState = {
      enabled: true,
      days: [0, 4, 5, 6],
      from: "06:00",
      to: "08:00",
      tzLabel: "PT",
    };
    expect(formStateToScoreWindow(pt)).toEqual({
      days: [0, 4, 5, 6],
      from: "06:00",
      to: "08:00",
      tz: "America/Los_Angeles",
    });

    const et: ScoreWindowFormState = { ...pt, tzLabel: "ET" };
    expect(formStateToScoreWindow(et)?.tz).toBe("America/New_York");

    const utc: ScoreWindowFormState = { ...pt, tzLabel: "UTC" };
    expect(formStateToScoreWindow(utc)?.tz).toBe("UTC");
  });
});

describe("scoreWindowToFormState — persisted ScoreWindow → form state", () => {
  it("returns the disabled/empty default when the window is absent", () => {
    expect(scoreWindowToFormState(undefined)).toEqual({
      enabled: false,
      days: [],
      from: "",
      to: "",
      tzLabel: "PT",
    });
  });

  it("rehydrates an enabled window, mapping the stored IANA id BACK to its label (raw tz carried too)", () => {
    expect(
      scoreWindowToFormState({ days: [4, 5], from: "06:00", to: "08:00", tz: "America/New_York" }),
    ).toEqual({
      enabled: true,
      days: [4, 5],
      from: "06:00",
      to: "08:00",
      tzLabel: "ET",
      tz: "America/New_York",
    });
  });

  it("keeps an EMPTY label but PRESERVES an unknown/unmapped IANA id (WR-02, no UTC coercion)", () => {
    expect(
      scoreWindowToFormState({ days: [1], from: "09:00", to: "10:00", tz: "Antarctica/Troll" }),
    ).toEqual({
      enabled: true,
      days: [1],
      from: "09:00",
      to: "10:00",
      tzLabel: "",
      tz: "Antarctica/Troll",
    });
  });
});

describe("round-trip — scoreWindowToFormState(formStateToScoreWindow(state)) (CTFT-11)", () => {
  it("preserves days/from/to/tz for an enabled window (save→edit fidelity)", () => {
    const state: ScoreWindowFormState = {
      enabled: true,
      days: [0, 4, 5, 6],
      from: "06:00",
      to: "08:00",
      tzLabel: "PT",
      tz: "America/Los_Angeles",
    };
    const persisted = formStateToScoreWindow(state);
    expect(persisted).toEqual({ ...DEFCON_RUN_HOURS });
    expect(scoreWindowToFormState(persisted)).toEqual(state);
  });

  it("round-trips an unrecognized IANA zone through the form UNCHANGED (WR-02 lossless tz)", () => {
    // A seeded/imported row whose zone is outside PT/ET/UTC. Editing and saving it
    // without touching the dropdown must NOT rewrite the zone to UTC.
    const stored: ScoreWindow = { days: [2, 3], from: "08:00", to: "09:00", tz: "America/Chicago" };
    const state = scoreWindowToFormState(stored);
    expect(state.tz).toBe("America/Chicago");
    expect(state.tzLabel).toBe(""); // no PT/ET/UTC label matches
    expect(formStateToScoreWindow(state)).toEqual(stored);
  });

  it("a subsequent explicit PT/ET/UTC pick OVERRIDES the carried raw zone", () => {
    // Start from an unknown zone, then the operator picks ET from the dropdown.
    const state = scoreWindowToFormState({
      days: [1],
      from: "09:00",
      to: "10:00",
      tz: "America/Chicago",
    });
    const picked: ScoreWindowFormState = { ...state, tzLabel: "ET" };
    expect(formStateToScoreWindow(picked)?.tz).toBe("America/New_York");
  });
});

describe("redactCtfSecrets — scoreWindow survives redaction (not a secret)", () => {
  it("carries scoreWindow through UNCHANGED onto the redacted record", () => {
    const window = { days: [0, 4, 5, 6], from: "06:00", to: "08:00", tz: "America/Los_Angeles" };
    const record: LoadedCtfRecord = {
      challenge: "day1",
      scoreWindow: window,
      otp: { secret: "GEZDGNBVGY3TQOJQ", digits: 6, period: 120 },
    };
    const redacted = redactCtfSecrets(record);
    expect(redacted.scoreWindow).toEqual(window);
    // The secret is still stripped (boundary intact); the window rode alongside it.
    expect(redacted.hasOtpSecret).toBe(true);
    expect((redacted as { otp?: { secret?: string } }).otp?.secret).toBeUndefined();
  });

  it("leaves scoreWindow undefined on a record that has none", () => {
    const redacted = redactCtfSecrets({ challenge: "day2" });
    expect(redacted.scoreWindow).toBeUndefined();
  });
});

describe("redactCtfSecrets — codeCounts passthrough (Slice 3, wordlist SC3)", () => {
  it("carries codeCounts through UNCHANGED while still stripping secrets", () => {
    const codeCounts = { loaded: 12, unclaimed: 5 };
    const record: LoadedCtfRecord = {
      challenge: "codes",
      answerType: "wordlist",
      codeCounts,
      // A secret alongside it: the boundary must still strip otp.secret + effect
      // while the non-secret aggregate counts ride through to the client.
      otp: { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 120 },
      effect: { kind: "confetti" },
    };
    const redacted = redactCtfSecrets(record);
    expect(redacted.codeCounts).toEqual(codeCounts);
    expect(redacted.answerType).toBe("wordlist");
    // Secrets still stripped — codeCounts is aggregate, never plaintext.
    expect(redacted.hasOtpSecret).toBe(true);
    expect((redacted as { otp?: { secret?: string } }).otp?.secret).toBeUndefined();
    expect((redacted as unknown as Record<string, unknown>).effect).toBeUndefined();
    // No plaintext code field is ever introduced onto the redacted record.
    expect((redacted as unknown as Record<string, unknown>).codes).toBeUndefined();
  });

  it("leaves codeCounts undefined on a record that has none", () => {
    const redacted = redactCtfSecrets({ challenge: "no-codes" });
    expect(redacted.codeCounts).toBeUndefined();
  });
});
