import { describe, it, expect, vi } from "vitest";
import { resolveRunHuman, resolveRunHumanMany } from "./runhuman-resolve";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("resolveRunHuman", () => {
  it("maps a found run.human user", async () => {
    const f = mockFetch(200, { found: true, runUserId: "rh1", displayName: "rabbit_Z" });
    const ref = await resolveRunHuman("sub1", f);
    expect(ref).toEqual({ found: true, runUserId: "rh1", displayName: "rabbit_Z" });
  });
  it("fail-soft on 404", async () => {
    const ref = await resolveRunHuman("subX", mockFetch(404, { error: "x" }));
    expect(ref).toEqual({ found: false, runUserId: null, displayName: null });
  });
  it("fail-soft on network throw", async () => {
    const f = vi.fn(async () => { throw new Error("boom"); }) as unknown as typeof fetch;
    expect(await resolveRunHuman("subX", f)).toEqual({ found: false, runUserId: null, displayName: null });
  });
  it("targets run.human's region-prefixed internal route (not a naked /api/internal that 404s)", async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: string) => { seen.push(url); return { ok: true, status: 200, json: async () => ({ found: true }) }; }) as unknown as typeof fetch;
    await resolveRunHuman("sub1", f);
    // Must hit /{region}/api/internal/... — regression guard for the missing-basePath 404.
    expect(seen[0]).toMatch(/\/use1\/api\/internal\/user\/sub1\?summary=1$/);
  });
});

describe("resolveRunHumanMany", () => {
  it("resolves a map keyed by sub", async () => {
    const f = vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => ({ found: true, runUserId: "rh-" + url.split("/").pop(), displayName: "d" }),
    })) as unknown as typeof fetch;
    const map = await resolveRunHumanMany(["a", "b"], f);
    expect(map.a.runUserId).toBe("rh-a?summary=1");
    expect(map.b.found).toBe(true);
  });
});
