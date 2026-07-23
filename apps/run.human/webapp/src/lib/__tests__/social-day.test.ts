import { describe, it, expect } from "vitest";

import { socialDay } from "../social-day";
import { shortTokenFromHash, TOKEN_RE } from "../short-token";

describe("socialDay (PT -7 fixed offset)", () => {
  it("maps a mid-day con timestamp to its PT date", () => {
    // 2026-08-06 18:00 UTC = 11:00 PDT
    expect(socialDay(Date.parse("2026-08-06T18:00:00Z"))).toBe("2026-08-06");
  });

  it("rolls over at PT midnight, not UTC midnight", () => {
    // 06:59 UTC is 23:59 PDT the previous day
    expect(socialDay(Date.parse("2026-08-06T06:59:59Z"))).toBe("2026-08-05");
    // 07:00 UTC is exactly PT midnight
    expect(socialDay(Date.parse("2026-08-06T07:00:00Z"))).toBe("2026-08-06");
  });
});

describe("shortTokenFromHash", () => {
  const HASH =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

  it("returns the first 16 hex chars", () => {
    const token = shortTokenFromHash(HASH);
    expect(token).toBe("9f86d081884c7d65");
    expect(TOKEN_RE.test(token)).toBe(true);
  });

  it("rejects non-sha256 input", () => {
    expect(() => shortTokenFromHash("abc")).toThrow();
    expect(() => shortTokenFromHash(HASH.toUpperCase())).toThrow();
    expect(() => shortTokenFromHash(HASH + "00")).toThrow();
  });
});
