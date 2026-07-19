import { describe, it, expect } from "vitest";

import {
  canonicalNodeId,
  nodeNumFromNodeId,
  normalizeNodeId,
  publicKeyBase64ToHex,
} from "../mesh-radio-canonical";

/**
 * Pure canonicalization + encoding tests (Phase 66, MRAD-02).
 *
 * Locks the two write-boundary transforms every MeshRadio writer applies:
 *   - nodeId pad-8 lowercase canonicalization (L2), incl. the leading-zero case
 *     that historically mismatched meshtk's fmt.Sprintf("!%08x", nodeNum).
 *   - base64 X25519 pubkey → "0x" hex with the strict 32-byte decode guard (L3).
 */

describe("canonicalNodeId", () => {
  it("renders a full-width nodeNum as !<8 hex> lowercase", () => {
    expect(canonicalNodeId(0x433d1cec)).toBe("!433d1cec");
  });

  it("pads a leading-zero nodeNum to 8 hex digits (L2 case)", () => {
    expect(canonicalNodeId(0x00abcdef)).toBe("!00abcdef");
  });

  it("coerces to unsigned 32-bit before formatting", () => {
    // (0xffffffff >>> 0) stays 8 digits; a value with a high bit set is unsigned.
    expect(canonicalNodeId(0xffffffff)).toBe("!ffffffff");
  });
});

describe("nodeNumFromNodeId", () => {
  it("round-trips canonicalNodeId for a full-width id", () => {
    const n = 0x433d1cec;
    expect(nodeNumFromNodeId(canonicalNodeId(n))).toBe(n);
  });

  it("round-trips canonicalNodeId for a leading-zero id", () => {
    const n = 0x00abcdef;
    expect(nodeNumFromNodeId(canonicalNodeId(n))).toBe(n);
  });

  it("parses a bare (no '!') hex id", () => {
    expect(nodeNumFromNodeId("abcdef")).toBe(0x00abcdef);
  });
});

describe("normalizeNodeId", () => {
  it("normalizes a bare hex string to !<pad-8> lowercase", () => {
    expect(normalizeNodeId("abcdef")).toBe("!00abcdef");
  });

  it("normalizes an already-'!hex' id to the same canonical form", () => {
    expect(normalizeNodeId("!abcdef")).toBe("!00abcdef");
  });

  it("lowercases an uppercase id", () => {
    expect(normalizeNodeId("!433D1CEC")).toBe("!433d1cec");
  });
});

describe("publicKeyBase64ToHex", () => {
  it("converts a 32-byte base64 key to '0x' + 64 lowercase hex chars", () => {
    const bytes = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) bytes[i] = i;
    const base64 = bytes.toString("base64");
    const hex = publicKeyBase64ToHex(base64);
    expect(hex).toBe("0x" + bytes.toString("hex"));
    expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("round-trips 0x hex back to the original 32 bytes", () => {
    const original = Buffer.alloc(32, 0xab);
    const hex = publicKeyBase64ToHex(original.toString("base64"));
    expect(Buffer.from(hex.slice(2), "hex").equals(original)).toBe(true);
  });

  it("throws on a 31-byte (too short) decode", () => {
    const short = Buffer.alloc(31).toString("base64");
    expect(() => publicKeyBase64ToHex(short)).toThrow(/32 bytes/);
  });

  it("throws on a 33-byte (too long) decode", () => {
    const long = Buffer.alloc(33).toString("base64");
    expect(() => publicKeyBase64ToHex(long)).toThrow(/32 bytes/);
  });
});
