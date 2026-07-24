import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcileAccomplishments: vi.fn(async () => ({ deleted: 1, created: 2 })),
}));

vi.mock("@/lib/gpx-reconcile", () => ({
  reconcileAccomplishments: mocks.reconcileAccomplishments,
}));

import { POST } from "./route";

function req(opts: { header?: string; body?: unknown; noBody?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.header !== undefined) headers["x-internal-secret"] = opts.header;
  return new Request("http://x/api/gpx/internal/reconcile", {
    method: "POST",
    headers,
    body: opts.noBody ? undefined : JSON.stringify(opts.body ?? {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reconcileAccomplishments.mockResolvedValue({ deleted: 1, created: 2 });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/gpx/internal/reconcile", () => {
  it("403s when no secret header is sent, even with a valid secret configured", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req({ body: { sub: "s1" } }));
    expect(res.status).toBe(403);
    expect(mocks.reconcileAccomplishments).not.toHaveBeenCalled();
  });

  it("403s when neither INTERNAL_SYNC_SECRET nor AUTH_INTERNAL_SECRET is set", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req({ header: "anything", body: { sub: "s1" } }));
    expect(res.status).toBe(403);
  });

  it("403s on a wrong secret", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "nope", body: { sub: "s1" } }));
    expect(res.status).toBe(403);
    expect(mocks.reconcileAccomplishments).not.toHaveBeenCalled();
  });

  it("falls back to AUTH_INTERNAL_SECRET when INTERNAL_SYNC_SECRET is unset", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", undefined);
    vi.stubEnv("AUTH_INTERNAL_SECRET", "fallback-secret");
    const res = await POST(req({ header: "fallback-secret", body: { sub: "s1" } }));
    expect(res.status).toBe(200);
    expect(mocks.reconcileAccomplishments).toHaveBeenCalledWith("s1");
  });

  it("400s when sub is missing", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "correct", body: {} }));
    expect(res.status).toBe(400);
    expect(mocks.reconcileAccomplishments).not.toHaveBeenCalled();
  });

  it("400s when sub is non-string", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "correct", body: { sub: 123 } }));
    expect(res.status).toBe(400);
    expect(mocks.reconcileAccomplishments).not.toHaveBeenCalled();
  });

  it("400s on an unparseable body", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "correct", noBody: true }));
    expect(res.status).toBe(400);
  });

  it("200s with {ok:true,created,deleted} on the happy path", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    const res = await POST(req({ header: "correct", body: { sub: "s1" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, created: 2, deleted: 1 });
    expect(mocks.reconcileAccomplishments).toHaveBeenCalledWith("s1");
  });

  it("500s when reconcileAccomplishments throws", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct");
    mocks.reconcileAccomplishments.mockRejectedValue(new Error("boom"));
    const res = await POST(req({ header: "correct", body: { sub: "s1" } }));
    expect(res.status).toBe(500);
  });
});
