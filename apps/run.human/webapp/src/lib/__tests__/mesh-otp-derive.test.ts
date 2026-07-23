import { describe, expect, it } from "vitest";

import {
  base32Encode,
  deriveOtpauthUrl,
  deriveTotpSecret,
} from "@/lib/mesh-otp-derive";
import { base32Decode } from "@/lib/ctf-otp-core";

/**
 * Shared cross-implementation vectors: the SAME table lives in meshtk's
 * pkg/otp/derive_test.go (whereiskurt/meshtk#10). If either side changes its
 * derivation, both suites fail — that parity is the whole point: the roster
 * page must reveal exactly the secret the deployed Go bot validates.
 */
const VECTORS = [
  {
    serverSecret: "test-server-secret",
    fleetId: "ghost.goldstein",
    committed: "GZRGQNKGKN4DINQ",
    derived: "XHNN23O25QAZITZ4CZTCXU4NIR6LRRCK",
  },
  {
    serverSecret: "test-server-secret",
    fleetId: "ghost.mudge",
    committed: "NA2DG",
    derived: "7KS3JJBI5CD6POHUUCC6XWHE65TXHGGX",
  },
  {
    serverSecret: "another-secret",
    fleetId: "ghost.condor",
    committed: "EZRWO",
    derived: "74M2OE6WWHRXQYZUBYC6ZJ6TX5NKGRDR",
  },
] as const;

describe("deriveTotpSecret", () => {
  it("matches the Go-side vectors bit-for-bit", () => {
    for (const v of VECTORS) {
      expect(deriveTotpSecret(v.serverSecret, v.fleetId, v.committed)).toBe(
        v.derived,
      );
    }
  });

  it("domain-separates on fleet id, server secret, and committed value", () => {
    const a = deriveTotpSecret("s", "ghost.a", "SEED");
    expect(deriveTotpSecret("s", "ghost.b", "SEED")).not.toBe(a);
    expect(deriveTotpSecret("s2", "ghost.a", "SEED")).not.toBe(a);
    expect(deriveTotpSecret("s", "ghost.a", "SEED2")).not.toBe(a);
  });

  it("emits 32 unpadded uppercase base32 chars (20 bytes)", () => {
    const s = deriveTotpSecret("s", "ghost.a", "SEED");
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe("base32Encode", () => {
  it("round-trips through ctf-otp-core's base32Decode", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("encodes the RFC 4648 test string", () => {
    // "foobar" → "MZXW6YTBOI" (RFC 4648 §10, padding stripped)
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
  });
});

describe("deriveOtpauthUrl", () => {
  const committed =
    "otpauth://totp/Emmanuel%20Goldstein?secret=GZRGQNKGKN4DINQ&issuer=Defcon.run&algorithm=SHA1&digits=6&period=120";

  it("swaps only the secret param, preserving identity params", () => {
    const { otpauth, secret, committedSecret } = deriveOtpauthUrl(
      "test-server-secret",
      "ghost.goldstein",
      committed,
    );
    expect(secret).toBe("XHNN23O25QAZITZ4CZTCXU4NIR6LRRCK");
    expect(committedSecret).toBe("GZRGQNKGKN4DINQ");
    const u = new URL(otpauth);
    expect(u.searchParams.get("secret")).toBe(secret);
    expect(u.searchParams.get("issuer")).toBe("Defcon.run");
    expect(u.searchParams.get("algorithm")).toBe("SHA1");
    expect(u.searchParams.get("digits")).toBe("6");
    expect(u.searchParams.get("period")).toBe("120");
    expect(otpauth).toContain("Emmanuel");
  });

  it("rejects a URL without a secret param", () => {
    expect(() =>
      deriveOtpauthUrl("s", "ghost.x", "otpauth://totp/Nope?issuer=Defcon.run"),
    ).toThrow(/no secret/);
  });

  it("rejects non-otpauth URLs", () => {
    expect(() =>
      deriveOtpauthUrl("s", "ghost.x", "https://example.com/?secret=AAAA"),
    ).toThrow(/otpauth/);
  });
});
