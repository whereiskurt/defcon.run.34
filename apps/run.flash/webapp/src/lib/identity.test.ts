import { describe, it, expect } from "vitest";
import {
  buildIdentity,
  clampLongName,
  buildShortName,
  utf8ByteLength,
  LONG_NAME_MAX_BYTES,
  SHORT_NAME_MAX_BYTES,
} from "./identity";

describe("utf8ByteLength", () => {
  it("counts bytes, not code units", () => {
    expect(utf8ByteLength("abcd")).toBe(4);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("🐰")).toBe(4);
  });
});

describe("clampLongName", () => {
  it("passes through short ASCII names with interior spaces", () => {
    expect(clampLongName("Agent X")).toBe("Agent X");
  });

  it("trims surrounding whitespace", () => {
    expect(clampLongName("  Agent X  ")).toBe("Agent X");
  });

  it("caps at the firmware byte limit", () => {
    const long = "x".repeat(LONG_NAME_MAX_BYTES + 10);
    const clamped = clampLongName(long);
    expect(utf8ByteLength(clamped)).toBe(LONG_NAME_MAX_BYTES);
  });

  it("never splits a code point at the cap", () => {
    // 38 ASCII bytes then a 4-byte emoji straddling the 39-byte boundary:
    // the emoji must be dropped whole, not byte-sliced into invalid UTF-8.
    const name = "x".repeat(LONG_NAME_MAX_BYTES - 1) + "🐰";
    const clamped = clampLongName(name);
    expect(clamped).toBe("x".repeat(LONG_NAME_MAX_BYTES - 1));
    expect(utf8ByteLength(clamped)).toBeLessThanOrEqual(LONG_NAME_MAX_BYTES);
  });
});

describe("buildShortName", () => {
  it("takes the first 4 uppercased characters of an ASCII name", () => {
    expect(buildShortName("Agent X")).toBe("AGEN");
  });

  it("stops at the 4-byte limit for multi-byte characters", () => {
    // é = 2 bytes, so É + A + B = 4 bytes; C would overflow.
    expect(buildShortName("éabc")).toBe("ÉAB");
  });

  it("uses a single leading emoji that exactly fills 4 bytes", () => {
    expect(buildShortName("🐰Agent")).toBe("🐰");
  });

  it("skips leading whitespace", () => {
    expect(buildShortName("  agent")).toBe("AGEN");
  });

  it("falls back when nothing fits", () => {
    expect(buildShortName("")).toBe("DC34");
    expect(buildShortName("   ")).toBe("DC34");
  });

  it("never exceeds the firmware byte limit", () => {
    for (const name of ["Agent X", "éabc", "🐰🐰", "ﬀﬀﬀ", "aé🐰"]) {
      expect(utf8ByteLength(buildShortName(name))).toBeLessThanOrEqual(
        SHORT_NAME_MAX_BYTES
      );
    }
  });

  it("drops an uppercased form that would overflow the byte limit", () => {
    // ﬁ (U+FB01, 3 bytes) uppercases to "FI" (2 bytes) — fine. But ﬀ×2 = 6 bytes
    // lowercased; uppercased "FFFF" = 4 bytes. Whatever the transform, the
    // result must fit — this guards the accumulate-then-uppercase ordering.
    const short = buildShortName("ﬀﬀﬀ");
    expect(utf8ByteLength(short)).toBeLessThanOrEqual(SHORT_NAME_MAX_BYTES);
    expect(short.length).toBeGreaterThan(0);
  });
});

describe("buildIdentity", () => {
  it("prefers displayName over session name", () => {
    const id = buildIdentity({
      displayName: "Agent X",
      sessionName: "Kurt H",
      userId: "abcd1234",
    });
    expect(id.longName).toBe("Agent X");
    expect(id.shortName).toBe("AGEN");
  });

  it("falls back to session name when displayName is missing or blank", () => {
    expect(
      buildIdentity({ displayName: null, sessionName: "Kurt H", userId: "abcd1234" })
        .longName
    ).toBe("Kurt H");
    expect(
      buildIdentity({ displayName: "   ", sessionName: "Kurt H", userId: "abcd1234" })
        .longName
    ).toBe("Kurt H");
  });

  it("falls back to a generated DCR34 name from the userId", () => {
    const id = buildIdentity({ displayName: null, sessionName: null, userId: "abcd1234" });
    expect(id.longName).toBe("DCR34_abcd");
    expect(id.shortName).toBe("DCR3");
  });

  it("clamps an over-long displayName and still derives a valid shortName", () => {
    const id = buildIdentity({
      displayName: "🐰" + "very long rabbit name ".repeat(5),
      sessionName: null,
      userId: "abcd1234",
    });
    expect(utf8ByteLength(id.longName)).toBeLessThanOrEqual(LONG_NAME_MAX_BYTES);
    expect(id.shortName).toBe("🐰");
  });
});
