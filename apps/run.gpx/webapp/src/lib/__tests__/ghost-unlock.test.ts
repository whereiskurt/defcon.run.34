import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { goldsteinUnlock, resetGhostUnlockCache } from "../ghost-unlock";
import { ghostFeatureCollection, type NodeDb } from "../mesh-nodes";

/**
 * The goldstein unlock clue must be fail-soft (feed never breaks on internal
 * hiccups), cached after first success, and attached to goldstein's feature
 * ONLY — no other ghost may carry seed properties.
 */

const UNLOCK = {
  secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  otpauth: "otpauth://totp/x?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  qr: "data:image/png;base64,aGk=",
};

const originalFetch = global.fetch;
beforeEach(() => resetGhostUnlockCache());
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("goldsteinUnlock", () => {
  it("returns the unlock info on a good response and caches it", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(UNLOCK), { status: 200 })
    );
    global.fetch = mock as typeof fetch;
    expect(await goldsteinUnlock()).toEqual({ secret: UNLOCK.secret, qr: UNLOCK.qr });
    expect(await goldsteinUnlock()).toEqual({ secret: UNLOCK.secret, qr: UNLOCK.qr });
    expect(mock).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it("returns null on non-200", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 403 })) as typeof fetch;
    expect(await goldsteinUnlock()).toBeNull();
  });

  it("returns null on fetch failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as typeof fetch;
    expect(await goldsteinUnlock()).toBeNull();
  });

  it("returns null when the body is missing fields or has a non-image qr", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ secret: "X", qr: "javascript:alert(1)" }), { status: 200 })
    ) as typeof fetch;
    expect(await goldsteinUnlock()).toBeNull();
  });
});

describe("ghostFeatureCollection goldstein enrichment", () => {
  const db: NodeDb = {
    "1": { longName: "ghost-goldstein-00", shortName: "GG00", latitude: 361000000, longitude: -1151000000 },
    "2": { longName: "ghost-turing-00", shortName: "GT00", latitude: 361000001, longitude: -1151000001 },
  };

  it("attaches unlockSeed/unlockQr to goldstein only", () => {
    const fc = ghostFeatureCollection(db, { secret: UNLOCK.secret, qr: UNLOCK.qr });
    const goldstein = fc.features.find((f) => f.properties?.slug === "goldstein")!;
    const turing = fc.features.find((f) => f.properties?.slug === "turing")!;
    expect(goldstein.properties?.unlockSeed).toBe(UNLOCK.secret);
    expect(goldstein.properties?.unlockQr).toBe(UNLOCK.qr);
    expect(turing.properties).not.toHaveProperty("unlockSeed");
    expect(turing.properties).not.toHaveProperty("unlockQr");
  });

  it("omits seed props entirely when unlock is null/absent", () => {
    for (const fc of [ghostFeatureCollection(db, null), ghostFeatureCollection(db)]) {
      for (const f of fc.features) {
        expect(f.properties).not.toHaveProperty("unlockSeed");
        expect(f.properties).not.toHaveProperty("unlockQr");
      }
    }
  });
});
