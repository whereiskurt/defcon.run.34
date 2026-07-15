import { describe, it, expect } from "vitest";

import { encodeFlag, decodeFlag } from "../ctf-covert-codec";
import { AWARD_PROP } from "../ctf-covert-css";

/**
 * The apex defcon.run STATIC landing (apps/static/landing/template.html) hardcodes
 * the covert payload for the dc34-egg `!!!` easter egg — it can't import this
 * module. These golden values pin what the landing must embed; if the codec or
 * award-prop ever changes, this fails and the landing string must be updated.
 */
const APEX_LANDING_COVERT_V = "2028500684477102817202729393385721";
const APEX_LANDING_AWARD_PROP = "--accent-ramp";

describe("apex landing covert payload (pinned — keep template.html in sync)", () => {
  it("encodeFlag('dc34-egg','!!!') matches the value the landing hardcodes", () => {
    expect(encodeFlag("dc34-egg", "!!!")).toBe(APEX_LANDING_COVERT_V);
    // and it decodes back to the egg (sanity: the landing fires the real flag)
    expect(decodeFlag(APEX_LANDING_COVERT_V)).toEqual({ challenge: "dc34-egg", guess: "!!!" });
  });

  it("AWARD_PROP matches the custom property the landing reads via getComputedStyle", () => {
    expect(AWARD_PROP).toBe(APEX_LANDING_AWARD_PROP);
  });
});

// Valid (challenge, guess) pairs spanning ascii, unicode, digits, spaces, empty.
const PAIRS: Array<{ challenge: string; guess: string }> = [
  { challenge: "dc34-egg", guess: "1337" },
  { challenge: "photo-1", guess: "the quick brown fox" },
  { challenge: "", guess: "" },
  { challenge: "a", guess: "b" },
  { challenge: "with spaces", guess: "and more   spaces" },
  { challenge: "unicode-🦊", guess: "café — naïve — 日本語" },
  { challenge: "0000", guess: "9999" },
  { challenge: "MiXeD-CaSe", guess: "MiXeD guess" },
];

describe("encodeFlag / decodeFlag", () => {
  it("round-trips every valid pair (reversible)", () => {
    for (const { challenge, guess } of PAIRS) {
      const v = encodeFlag(challenge, guess);
      expect(decodeFlag(v)).toEqual({ challenge, guess });
    }
  });

  it("encodeFlag output is pure decimal digits (version-stamp plausible)", () => {
    for (const { challenge, guess } of PAIRS) {
      expect(encodeFlag(challenge, guess)).toMatch(/^[0-9]+$/);
    }
  });

  it("returns null for structurally-invalid v (total, no throw)", () => {
    for (const bad of ["", "abc", "-5", "12.5", "1e5", " 42", "42 ", "0x1f", "٤٢"]) {
      expect(decodeFlag(bad)).toBeNull();
    }
  });

  it("returns null for a plausible build-date number that fails the checksum", () => {
    // Sanity from the plan: "20260806" is not a valid encoding.
    expect(decodeFlag("20260806")).toBeNull();
  });

  it("never throws on hostile input (T-46-01)", () => {
    const hostile = [
      "",
      "9".repeat(5000),
      "0",
      "00000",
      "-1",
      "not a number",
      "☃",
      String(Number.MAX_SAFE_INTEGER),
    ];
    for (const h of hostile) {
      expect(() => decodeFlag(h)).not.toThrow();
    }
  });

  it("decodes the overwhelming majority of random decimal strings to null (decoy trigger)", () => {
    const N = 2000;
    let nulls = 0;
    for (let i = 0; i < N; i++) {
      const len = 1 + Math.floor(Math.random() * 24);
      let s = String(1 + Math.floor(Math.random() * 9));
      for (let j = 1; j < len; j++) s += String(Math.floor(Math.random() * 10));
      if (decodeFlag(s) === null) nulls++;
    }
    // Checksum (mod 97) alone yields ~99% rejection; require a high floor.
    expect(nulls / N).toBeGreaterThan(0.9);
  });
});
