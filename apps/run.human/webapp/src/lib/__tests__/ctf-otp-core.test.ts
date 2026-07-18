import { describe, it, expect } from "vitest";

import {
  buildOtpauth,
  parseOtpauth,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD,
  DEFAULT_ALGORITHM,
  DEFAULT_ISSUER,
} from "../ctf-otp-core";

/** A base32 secret (RFC 4648 alphabet only — needs no URL escaping). */
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("buildOtpauth — inverse of parseOtpauth", () => {
  it("emits a well-formed otpauth://totp URL with the meshtk defaults", () => {
    const url = buildOtpauth({ secret: SECRET, label: "didhtp1" });
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    const p = parseOtpauth(url);
    expect(p.secret).toBe(SECRET);
    expect(p.digits).toBe(DEFAULT_DIGITS);
    expect(p.period).toBe(DEFAULT_PERIOD);
    expect(p.algorithm).toBe(DEFAULT_ALGORITHM);
    expect(p.issuer).toBe(DEFAULT_ISSUER);
    // label carries the "<issuer>:<account>" convention.
    expect(p.label).toBe(`${DEFAULT_ISSUER}:didhtp1`);
  });

  it("round-trips explicit non-default digits/period/algorithm", () => {
    const url = buildOtpauth({
      secret: SECRET,
      label: "flag",
      issuer: "ACME",
      digits: 8,
      period: 30,
      algorithm: "SHA256",
    });
    const p = parseOtpauth(url);
    expect(p.secret).toBe(SECRET);
    expect(p.digits).toBe(8);
    expect(p.period).toBe(30);
    expect(p.algorithm).toBe("SHA256");
    expect(p.issuer).toBe("ACME");
    expect(p.label).toBe("ACME:flag");
  });

  it("uppercases the algorithm like parseOtpauth does", () => {
    const url = buildOtpauth({ secret: SECRET, label: "x", algorithm: "sha1" });
    expect(parseOtpauth(url).algorithm).toBe("SHA1");
  });

  it("falls back to the issuer as the account label when none is given", () => {
    const url = buildOtpauth({ secret: SECRET });
    expect(parseOtpauth(url).label).toBe(`${DEFAULT_ISSUER}:${DEFAULT_ISSUER}`);
  });

  it("percent-encodes a label with spaces so it still parses back", () => {
    const url = buildOtpauth({ secret: SECRET, label: "my flag", issuer: "DEF CON" });
    const p = parseOtpauth(url);
    expect(p.label).toBe("DEF CON:my flag");
    expect(p.issuer).toBe("DEF CON");
  });

  it("throws when the secret is empty (nothing to enroll)", () => {
    expect(() => buildOtpauth({ secret: "" })).toThrow(/secret/i);
  });
});
