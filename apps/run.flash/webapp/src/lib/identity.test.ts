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
  it("removes interior spaces", () => {
    expect(clampLongName("Agent X")).toBe("AgentX");
  });

  it("removes ALL whitespace, including tabs and non-breaking spaces", () => {
    expect(clampLongName("  Agent\tX  ")).toBe("AgentX");
    expect(clampLongName("Agent X")).toBe("AgentX");
    expect(clampLongName("Agent\nX")).toBe("AgentX");
  });

  it("caps at the 30-byte limit", () => {
    expect(LONG_NAME_MAX_BYTES).toBe(30);
    const long = "x".repeat(LONG_NAME_MAX_BYTES + 10);
    const clamped = clampLongName(long);
    expect(utf8ByteLength(clamped)).toBe(LONG_NAME_MAX_BYTES);
  });

  it("caps AFTER whitespace removal, not before", () => {
    // 15 chars + space + 20 chars = 36 chars, but only 35 bytes of non-space:
    // the space is stripped first, then the first 30 bytes are kept.
    const clamped = clampLongName("x".repeat(15) + " " + "y".repeat(20));
    expect(clamped).toBe("x".repeat(15) + "y".repeat(15));
  });

  it("never splits a code point at the cap", () => {
    // 29 ASCII bytes then a 4-byte emoji straddling the 30-byte boundary:
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
  it("prefers displayName over session name, with whitespace stripped", () => {
    const id = buildIdentity({
      displayName: "Agent X",
      sessionName: "Kurt H",
      userId: "abcd1234",
    });
    expect(id.longName).toBe("AgentX");
    expect(id.shortName).toBe("AGEN");
  });

  it("falls back to session name when displayName is missing or blank", () => {
    expect(
      buildIdentity({ displayName: null, sessionName: "Kurt H", userId: "abcd1234" })
        .longName
    ).toBe("KurtH");
    expect(
      buildIdentity({ displayName: "   ", sessionName: "Kurt H", userId: "abcd1234" })
        .longName
    ).toBe("KurtH");
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
