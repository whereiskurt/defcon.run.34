import { describe, it, expect } from "vitest";

// Client (browser-safe, Web Crypto) under test:
import { adjacentCodesAsync, isSupportedAlgorithm } from "../ctf-otp-client";
// Server (node:crypto) reference — the async path must match it byte-for-behavior:
import { adjacentCodes } from "../ctf-otp";

/**
 * RFC 6238 test secret: ASCII "12345678901234567890" as base32. The published
 * vector below (t=59, 30s period, 8 digits → 94287082) is an INDEPENDENT anchor
 * so the async truncation is not only cross-checked against the sync path but
 * also pinned to the RFC, catching a shared bug in both implementations.
 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
/** A second, differently-shaped valid base32 secret for matrix coverage. */
const SECRET_2 = "JBSWY3DPEHPK3PXP";

type Opts = { digits?: number; period?: number };

// secrets × times × option-sets, including a period boundary (remainingSeconds
// === period) and both the meshtk (120/6) and RFC (30/8) parameterizations.
const SECRETS = [RFC_SECRET, SECRET_2];
const TIMES = [
  59, // RFC vector time
  1700000000, // meshtk pin time (mid-period: 1700000000 % 120 === 80)
  1699999920, // period-120 BOUNDARY: 1699999920 % 120 === 0 → remainingSeconds === 120
  1111111109,
  1234567890,
  2000000000,
];
const OPTSETS: Opts[] = [
  { period: 120, digits: 6 }, // meshtk convention
  { period: 30, digits: 8 }, // RFC 6238 parameterization
  {}, // defaults (period 120 / digits 6)
];

describe("adjacentCodesAsync — Web Crypto parity with the sync server path", () => {
  for (const secret of SECRETS) {
    for (const now of TIMES) {
      for (const opts of OPTSETS) {
        const label = `secret=${secret.slice(0, 6)}… now=${now} opts=${JSON.stringify(opts)}`;
        it(`deep-equals sync adjacentCodes (${label})`, async () => {
          const asyncResult = await adjacentCodesAsync(secret, now, opts);
          const syncResult = adjacentCodes(secret, now, opts);
          expect(asyncResult).toEqual(syncResult);
        });
      }
    }
  }

  it("hits the period boundary (remainingSeconds === period)", async () => {
    const res = await adjacentCodesAsync(RFC_SECRET, 1699999920, { period: 120, digits: 6 });
    expect(res.remainingSeconds).toBe(120);
  });

  it("matches an independent RFC 6238 vector (t=59, 30s, 8 digits → 94287082)", async () => {
    // RFC 6238 Appendix B SHA1 row. current bucket for t=59 at 30s === "94287082".
    const res = await adjacentCodesAsync(RFC_SECRET, 59, { period: 30, digits: 8 });
    expect(res.current).toBe("94287082");
  });
});

/**
 * WR-02: the client now honors the enrollment URL's `algorithm` instead of
 * hard-coding SHA1 and silently no-op'ing a non-SHA1 URL. Anchored to the RFC 6238
 * Appendix B SHA256/SHA512 vectors (each algorithm uses its own seed length:
 * 20/32/64 bytes of the ASCII "1234567890…" pattern, base32-encoded below).
 */
describe("adjacentCodesAsync — algorithm threading (WR-02)", () => {
  // ASCII "12345678901234567890123456789012" (32 bytes) → base32.
  const SHA256_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
  // ASCII "1234...1234" (64 bytes) → base32.
  const SHA512_SECRET =
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";

  it("computes the RFC 6238 SHA256 vector (t=59, 30s, 8 digits → 46119246)", async () => {
    const res = await adjacentCodesAsync(SHA256_SECRET, 59, {
      period: 30,
      digits: 8,
      algorithm: "SHA256",
    });
    expect(res.current).toBe("46119246");
  });

  it("computes the RFC 6238 SHA512 vector (t=59, 30s, 8 digits → 90693936)", async () => {
    const res = await adjacentCodesAsync(SHA512_SECRET, 59, {
      period: 30,
      digits: 8,
      algorithm: "SHA512",
    });
    expect(res.current).toBe("90693936");
  });

  it("is case-insensitive on the algorithm name", async () => {
    const upper = await adjacentCodesAsync(SHA256_SECRET, 59, {
      period: 30,
      digits: 8,
      algorithm: "SHA256",
    });
    const lower = await adjacentCodesAsync(SHA256_SECRET, 59, {
      period: 30,
      digits: 8,
      algorithm: "sha256",
    });
    expect(lower.current).toBe(upper.current);
  });

  it("defaults to SHA1 when no algorithm is given (unchanged behavior)", async () => {
    const explicit = await adjacentCodesAsync(RFC_SECRET, 59, {
      period: 30,
      digits: 8,
      algorithm: "SHA1",
    });
    const implicit = await adjacentCodesAsync(RFC_SECRET, 59, { period: 30, digits: 8 });
    expect(explicit).toEqual(implicit);
    expect(implicit.current).toBe("94287082");
  });

  it("throws (rather than silently no-ops) on a genuinely unsupported algorithm", async () => {
    await expect(
      adjacentCodesAsync(RFC_SECRET, 59, { algorithm: "SHA384" }),
    ).rejects.toThrow(/unsupported algorithm/i);
  });

  it("isSupportedAlgorithm reports SHA1/256/512 supported, others not", () => {
    expect(isSupportedAlgorithm("SHA1")).toBe(true);
    expect(isSupportedAlgorithm("sha256")).toBe(true);
    expect(isSupportedAlgorithm("SHA512")).toBe(true);
    expect(isSupportedAlgorithm("SHA384")).toBe(false);
    expect(isSupportedAlgorithm("MD5")).toBe(false);
  });
});
