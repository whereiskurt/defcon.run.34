import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The ghost-unlock internal endpoint publishes goldstein's DM-unlock seed to
 * the run.gpx ghosts feed (map-popup CTF clue). It must be unreachable without
 * the internal secret, and must expose ONLY the unlock seed (derived via
 * revealGhostOtp — the meshtk-otp-seed HKDF label), never the chain seed.
 */

vi.mock("@/config", () => ({ config: { auth: { internalSecret: "test-internal" } } }));

const OLD_KEY = process.env.MESHTK_GHOST_KEY_SECRET;
beforeEach(() => {
  vi.resetModules();
  process.env.MESHTK_GHOST_KEY_SECRET = "test-ghost-key";
});
afterEach(() => {
  process.env.MESHTK_GHOST_KEY_SECRET = OLD_KEY;
});

function req(url: string, secret?: string) {
  return new NextRequest(
    `http://internal.test${url}`,
    secret ? { headers: { "x-internal-secret": secret } } : undefined
  );
}

describe("GET /api/internal/ghost-unlock", () => {
  it("403s without the internal secret", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/internal/ghost-unlock?ghost=ghost.goldstein"));
    expect(res.status).toBe(403);
  });

  it("403s with a wrong secret", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/internal/ghost-unlock?ghost=ghost.goldstein", "nope"));
    expect(res.status).toBe(403);
  });

  it("400s without a ghost param", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/internal/ghost-unlock", "test-internal"));
    expect(res.status).toBe(400);
  });

  it("422s for an unknown ghost", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/internal/ghost-unlock?ghost=ghost.nope", "test-internal"));
    expect(res.status).toBe(422);
  });

  it("422s when the ghost key secret is unset", async () => {
    delete process.env.MESHTK_GHOST_KEY_SECRET;
    const { GET } = await import("./route");
    const res = await GET(req("/api/internal/ghost-unlock?ghost=ghost.goldstein", "test-internal"));
    expect(res.status).toBe(422);
  });

  it("returns seed + otpauth + QR data-URI for goldstein", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/internal/ghost-unlock?ghost=ghost.goldstein", "test-internal"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ghostId: string;
      secret: string;
      otpauth: string;
      qr: string;
    };
    expect(body.ghostId).toBe("ghost.goldstein");
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.otpauth).toContain("otpauth://");
    expect(body.otpauth).toContain(`secret=${body.secret}`);
    expect(body.qr).toMatch(/^data:image\/png;base64,/);
  });
});
