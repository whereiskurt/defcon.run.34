import { describe, it, expect } from "vitest";
import { crc32, nodeIdFromPublicKeyBase64 } from "./node-id";

describe("crc32", () => {
  // Canonical IEEE 802.3 CRC-32 vectors — the same polynomial Python's
  // zlib.crc32 and the Meshtastic firmware's crc32Buffer() use.
  it("matches zlib.crc32 on the standard check vector", () => {
    const bytes = new TextEncoder().encode("123456789");
    expect(crc32(bytes) >>> 0).toBe(0xcbf43926);
  });

  it("returns 0 for empty input", () => {
    expect(crc32(new Uint8Array(0)) >>> 0).toBe(0);
  });

  it("matches zlib.crc32 on a short ASCII string", () => {
    // python -c "import zlib; print(hex(zlib.crc32(b'defcon.run')))"
    const bytes = new TextEncoder().encode("defcon.run");
    expect(crc32(bytes) >>> 0).toBe(0xb1d226af);
  });
});

describe("nodeIdFromPublicKeyBase64", () => {
  // Live capture, 2026-08-01: a T-Deck Plus flashed with 2.8.0.b4ff1df.
  // The wizard's pre-key handshake reported the MAC-derived !a1cc1d70, but the
  // device booted as !66b5d888 — crc32 of the X25519 public key below. This is
  // the exact regression this module exists to prevent.
  const TDECK_PUBKEY = "WJgf4Ut2cKF5+C5TsS/mx1pDHHsxTGQhDcabkXX/uUI=";

  it("derives the node ID the 2.8 firmware will boot with", () => {
    expect(nodeIdFromPublicKeyBase64(TDECK_PUBKEY)).toBe("!66b5d888");
  });

  it("emits canonical lowercase pad-8 hex", () => {
    const id = nodeIdFromPublicKeyBase64(TDECK_PUBKEY);
    expect(id).toMatch(/^![0-9a-f]{8}$/);
  });

  it("returns null for an empty key (device had not generated one)", () => {
    expect(nodeIdFromPublicKeyBase64("")).toBeNull();
  });

  it("returns null when the key does not decode to exactly 32 bytes", () => {
    // 16 bytes, not 32 — a truncated or malformed SECURITY_CONFIG read.
    expect(nodeIdFromPublicKeyBase64(btoa("0123456789abcdef"))).toBeNull();
  });

  it("returns null for undecodable base64 rather than throwing", () => {
    expect(nodeIdFromPublicKeyBase64("!!!not base64!!!")).toBeNull();
  });
});
