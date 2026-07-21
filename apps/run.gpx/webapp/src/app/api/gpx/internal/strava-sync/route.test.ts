import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  runStravaSync: vi.fn(async () => ({ users: 1, imported: 2 })),
}));

vi.mock("@/lib/strava-sync", () => ({ runStravaSync: mocks.runStravaSync }));

import { POST } from "./route";

function req(opts: { header?: string; body?: unknown; noBody?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.header !== undefined) headers["x-internal-secret"] = opts.header;
  return new Request("http://x/api/gpx/internal/strava-sync", {
    method: "POST",
    headers,
    body: opts.noBody ? undefined : JSON.stringify(opts.body ?? {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runStravaSync.mockResolvedValue({ users: 1, imported: 2 });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/gpx/internal/strava-sync", () => {
  it("403s when no secret header is sent, even with a valid secret configured", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mocks.runStravaSync).not.toHaveBeenCalled();
  });

  it("403s when neither INTERNAL_SYNC_SECRET nor AUTH_INTERNAL_SECRET is set", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req({ header: "anything" }));
    expect(res.status).toBe(403);
    expect(mocks.runStravaSync).not.toHaveBeenCalled();
  });

  it("403s on a wrong secret when only INTERNAL_SYNC_SECRET is set", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req({ header: "nope" }));
    expect(res.status).toBe(403);
  });

  it("falls back to AUTH_INTERNAL_SECRET when INTERNAL_SYNC_SECRET is unset (2026-07-21 pattern)", async () => {
    // undefined (not "") so the `??` fallback actually kicks in, matching a
    // deployed task that never had INTERNAL_SYNC_SECRET provisioned at all.
    vi.stubEnv("INTERNAL_SYNC_SECRET", undefined);
    vi.stubEnv("AUTH_INTERNAL_SECRET", "fallback-secret");
    const res = await POST(req({ header: "fallback-secret" }));
    expect(res.status).toBe(200);
    expect(mocks.runStravaSync).toHaveBeenCalledTimes(1);
  });

  it("forwards a valid afterDays from the JSON body", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "correct", body: { afterDays: 14 } }));
    expect(res.status).toBe(200);
    expect(mocks.runStravaSync).toHaveBeenCalledWith(14);
  });

  it("ignores an out-of-range afterDays and falls back to the default", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "correct", body: { afterDays: 999 } }));
    expect(res.status).toBe(200);
    expect(mocks.runStravaSync).toHaveBeenCalledWith(undefined);
  });

  it("ignores a non-integer afterDays and falls back to the default", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "correct", body: { afterDays: 3.5 } }));
    expect(res.status).toBe(200);
    expect(mocks.runStravaSync).toHaveBeenCalledWith(undefined);
  });

  it("defaults afterDays to undefined with no body at all", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "correct", noBody: true }));
    expect(res.status).toBe(200);
    expect(mocks.runStravaSync).toHaveBeenCalledWith(undefined);
  });

  it("500s when runStravaSync throws", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    mocks.runStravaSync.mockRejectedValue(new Error("boom"));
    const res = await POST(req({ header: "correct", body: {} }));
    expect(res.status).toBe(500);
  });
});
