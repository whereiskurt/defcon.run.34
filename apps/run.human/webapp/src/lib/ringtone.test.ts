import { describe, it, expect } from "vitest";
import { validateRingtone, MAX_RINGTONE_LEN } from "./ringtone";

describe("validateRingtone", () => {
  it("accepts a well-formed RTTTL string", () => {
    const r = validateRingtone("dcrun:d=8,o=6,b=140:c,e,g,c7");
    expect(r).toEqual({ ok: true, value: "dcrun:d=8,o=6,b=140:c,e,g,c7" });
  });
  it("trims surrounding whitespace", () => {
    const r = validateRingtone("  og:d=8,o=5,b=110:g,p,g  ");
    expect(r).toEqual({ ok: true, value: "og:d=8,o=5,b=110:g,p,g" });
  });
  it("treats null/empty/blank as a clear (value null)", () => {
    expect(validateRingtone(null)).toEqual({ ok: true, value: null });
    expect(validateRingtone(undefined)).toEqual({ ok: true, value: null });
    expect(validateRingtone("   ")).toEqual({ ok: true, value: null });
  });
  it("rejects strings over the length cap", () => {
    const long = "x:d=8:" + "c,".repeat(200);
    const r = validateRingtone(long);
    expect(r.ok).toBe(false);
  });
  it("rejects non-RTTTL shapes (needs name:defaults:notes)", () => {
    expect(validateRingtone("just some text").ok).toBe(false);
    expect(validateRingtone("a:b").ok).toBe(false);
    expect(validateRingtone("::").ok).toBe(false);
  });
  it("exposes the cap constant", () => {
    expect(MAX_RINGTONE_LEN).toBe(230);
  });
});
