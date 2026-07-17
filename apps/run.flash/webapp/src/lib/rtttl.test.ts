import { describe, it, expect } from "vitest";
import { isValidRtttl, MAX_RINGTONE_LEN } from "./rtttl";
import { RINGTONES } from "@/config/meshtastic";

describe("isValidRtttl", () => {
  it("accepts every built-in class ringtone", () => {
    for (const tune of Object.values(RINGTONES)) {
      expect(isValidRtttl(tune)).toBe(true);
    }
  });

  it("accepts well-formed tunes (durations, octaves, sharps, pauses, dots)", () => {
    expect(isValidRtttl("mine:d=8:c")).toBe(true);
    expect(isValidRtttl("x:d=8,o=5,b=120:2g")).toBe(true);
    expect(isValidRtttl("s:d=4,o=5,b=100:4d#")).toBe(true);
    expect(isValidRtttl("p:o=6:c,p,e,g,c7")).toBe(true);
    expect(isValidRtttl("dot:d=8:c.,8a#5.")).toBe(true);
    expect(isValidRtttl("  pad:d=8:c,e  ")).toBe(true); // surrounding whitespace ok
  });

  it("rejects empty / blank / non-string input", () => {
    expect(isValidRtttl("")).toBe(false);
    expect(isValidRtttl("   ")).toBe(false);
    expect(isValidRtttl(undefined)).toBe(false);
    expect(isValidRtttl(null)).toBe(false);
    expect(isValidRtttl(123 as unknown)).toBe(false);
  });

  it("rejects structurally malformed strings", () => {
    expect(isValidRtttl("no-colons-here")).toBe(false);
    expect(isValidRtttl("name:d=8")).toBe(false); // only two sections
    expect(isValidRtttl("name:d=8:")).toBe(false); // empty notes section
    expect(isValidRtttl(":d=8:c")).toBe(false); // empty name
    expect(isValidRtttl("name:oops:c")).toBe(false); // bad control entry
    expect(isValidRtttl("name:d=8:zzz")).toBe(false); // bad note token
    expect(isValidRtttl("waytoolongname:d=8:c")).toBe(false); // name > 10 chars
  });

  it("rejects tunes over the firmware length cap (never truncates)", () => {
    const tooLong = "x:d=8:" + "c,".repeat(300);
    expect(tooLong.length).toBeGreaterThan(MAX_RINGTONE_LEN);
    expect(isValidRtttl(tooLong)).toBe(false);
  });
});
