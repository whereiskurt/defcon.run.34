import { describe, it, expect } from "vitest";

import {
  parseOtpauth,
  totpAt,
  adjacentCodes,
  verifyTotp,
  _constantTimeEqual,
} from "../ctf-otp";

/**
 * RFC 6238 test secret: ASCII "12345678901234567890" encoded as base32.
 * The published RFC vectors below were reproduced with an independent Python
 * hmac oracle (stdlib), so these assertions do NOT circularly depend on the
 * TS implementation under test.
 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

/** A fixed timestamp used for the period-120 / 6-digit meshtk-convention pins. */
const FIXED_TS = 1700000000;

describe("totpAt — RFC 6238 vectors (parameterized to 30s / 8-digit SHA1)", () => {
  // https://datatracker.ietf.org/doc/html/rfc6238#appendix-B (SHA1 column)
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it.each(vectors)("t=%d → %s", (ts, expected) => {
    expect(totpAt(RFC_SECRET, ts, { digits: 8, period: 30 })).toBe(expected);
  });
});

describe("totpAt — period 120 / 6 digits (meshtk convention)", () => {
  it("returns a stable pinned 6-digit code at a fixed timestamp", () => {
    // pinned via the independent Python oracle at period=120, digits=6
    expect(totpAt(RFC_SECRET, FIXED_TS, { digits: 6, period: 120 })).toBe("943734");
  });

  it("defaults to digits 6 / period 120 when opts are omitted", () => {
    expect(totpAt(RFC_SECRET, FIXED_TS)).toBe("943734");
  });

  it("is stable across the whole period (same counter bucket)", () => {
    // FIXED_TS floors to period start 1699999920; +40s stays in the same bucket
    expect(totpAt(RFC_SECRET, 1699999920)).toBe("943734");
    expect(totpAt(RFC_SECRET, 1699999920 + 119)).toBe("943734");
  });

  it("normalizes lowercase / spaced secrets like the Go core", () => {
    expect(totpAt("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", FIXED_TS)).toBe("943734");
  });

  it("produces a zero-padded, digits-length numeric string", () => {
    expect(totpAt(RFC_SECRET, FIXED_TS, { digits: 6, period: 120 })).toMatch(/^\d{6}$/);
  });
});

describe("adjacentCodes", () => {
  it("returns previous / current / next codes for the window straddling now", () => {
    const { previous, current, next } = adjacentCodes(RFC_SECRET, FIXED_TS, {
      digits: 6,
      period: 120,
    });
    // pinned via the independent Python oracle
    expect(previous).toBe("123228");
    expect(current).toBe("943734");
    expect(next).toBe("666847");
  });

  it("remainingSeconds is within [1, period]", () => {
    const { remainingSeconds } = adjacentCodes(RFC_SECRET, FIXED_TS, {
      digits: 6,
      period: 120,
    });
    expect(remainingSeconds).toBeGreaterThanOrEqual(1);
    expect(remainingSeconds).toBeLessThanOrEqual(120);
    // FIXED_TS % 120 === 80 → 120 - 80 = 40 seconds left
    expect(remainingSeconds).toBe(40);
  });
});

describe("verifyTotp — skew boundary (NEW logic; the Go has no verify)", () => {
  it("accepts the previous-period code within skew=1", () => {
    expect(verifyTotp(RFC_SECRET, "123228", FIXED_TS, { digits: 6, period: 120, skew: 1 })).toBe(
      true,
    );
  });

  it("accepts the current-period code", () => {
    expect(verifyTotp(RFC_SECRET, "943734", FIXED_TS, { digits: 6, period: 120, skew: 1 })).toBe(
      true,
    );
  });

  it("accepts the next-period code within skew=1", () => {
    expect(verifyTotp(RFC_SECRET, "666847", FIXED_TS, { digits: 6, period: 120, skew: 1 })).toBe(
      true,
    );
  });

  it("rejects a code two periods away (outside skew=1)", () => {
    // totpAt(secret, FIXED_TS + 240) === "374811" (two windows ahead)
    expect(verifyTotp(RFC_SECRET, "374811", FIXED_TS, { digits: 6, period: 120, skew: 1 })).toBe(
      false,
    );
  });

  it("defaults skew to 1 when omitted", () => {
    expect(verifyTotp(RFC_SECRET, "666847", FIXED_TS, { digits: 6, period: 120 })).toBe(true);
    expect(verifyTotp(RFC_SECRET, "374811", FIXED_TS, { digits: 6, period: 120 })).toBe(false);
  });

  it("rejects a wrong-length guess without throwing", () => {
    expect(() => verifyTotp(RFC_SECRET, "94373", FIXED_TS, { digits: 6, period: 120 })).not.toThrow();
    expect(verifyTotp(RFC_SECRET, "94373", FIXED_TS, { digits: 6, period: 120 })).toBe(false);
  });

  it("rejects a non-numeric / empty guess without throwing", () => {
    expect(verifyTotp(RFC_SECRET, "abcdef", FIXED_TS, { digits: 6, period: 120 })).toBe(false);
    expect(verifyTotp(RFC_SECRET, "", FIXED_TS, { digits: 6, period: 120 })).toBe(false);
  });

  it("returns false (never throws) on an undecodable secret", () => {
    expect(() => verifyTotp("!!!not-base32!!!", "943734", FIXED_TS)).not.toThrow();
    expect(verifyTotp("!!!not-base32!!!", "943734", FIXED_TS)).toBe(false);
  });
});

describe("_constantTimeEqual — length-guarded crypto.timingSafeEqual seam", () => {
  it("true for equal strings", () => {
    expect(_constantTimeEqual("943734", "943734")).toBe(true);
  });

  it("false for different same-length strings", () => {
    expect(_constantTimeEqual("943734", "000000")).toBe(false);
  });

  it("false (no throw) for different-length strings", () => {
    expect(() => _constantTimeEqual("94373", "943734")).not.toThrow();
    expect(_constantTimeEqual("94373", "943734")).toBe(false);
  });

  it("false (no throw) on empty input", () => {
    expect(_constantTimeEqual("", "943734")).toBe(false);
    expect(_constantTimeEqual("943734", "")).toBe(false);
  });
});

describe("parseOtpauth", () => {
  it("parses a full otpauth:// URL with explicit params", () => {
    const url = `otpauth://totp/Defcon.run:goldstein-dawn?secret=${RFC_SECRET}&period=120&digits=6&issuer=Defcon.run&algorithm=SHA1`;
    const cfg = parseOtpauth(url);
    expect(cfg.secret).toBe(RFC_SECRET);
    expect(cfg.digits).toBe(6);
    expect(cfg.period).toBe(120);
    expect(cfg.algorithm).toBe("SHA1");
    expect(cfg.issuer).toBe("Defcon.run");
    expect(cfg.label).toBe("Defcon.run:goldstein-dawn");
  });

  it("applies defaults (digits 6, period 120, SHA1, issuer Defcon.run) when params are absent", () => {
    const cfg = parseOtpauth(`otpauth://totp/goldstein?secret=${RFC_SECRET}`);
    expect(cfg.digits).toBe(6);
    expect(cfg.period).toBe(120);
    expect(cfg.algorithm).toBe("SHA1");
    expect(cfg.issuer).toBe("Defcon.run");
    expect(cfg.label).toBe("goldstein");
  });

  it("uppercases the algorithm", () => {
    const cfg = parseOtpauth(`otpauth://totp/x?secret=${RFC_SECRET}&algorithm=sha1`);
    expect(cfg.algorithm).toBe("SHA1");
  });

  it("throws on a non-otpauth scheme", () => {
    expect(() => parseOtpauth(`https://totp/x?secret=${RFC_SECRET}`)).toThrow();
  });

  it("throws when the secret is missing", () => {
    expect(() => parseOtpauth("otpauth://totp/x")).toThrow();
  });

  it("round-trips: totpAt(parseOtpauth(url).secret, ...) matches the pinned code", () => {
    const cfg = parseOtpauth(`otpauth://totp/x?secret=${RFC_SECRET}&period=120&digits=6`);
    expect(totpAt(cfg.secret, FIXED_TS, { digits: cfg.digits, period: cfg.period })).toBe("943734");
  });
});
