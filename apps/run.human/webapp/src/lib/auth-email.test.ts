import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/config", () => ({
  config: {
    urls: { privateAuthServer: "http://auth.test" },
    auth: { internalSecret: "s3cr3t" },
  },
}));

import { getAuthEmailBySub } from "@/lib/auth-email";

/**
 * getAuthEmailBySub reads the authoritative login email from run.auth's internal
 * validate endpoint. Fail-open: any miss yields null so provisioning can skip
 * rather than crash a bib save.
 */
describe("getAuthEmailBySub()", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the email from a valid response and sends the internal secret", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, user: { email: "a@x.com" } }),
    });
    await expect(getAuthEmailBySub("sub-1")).resolves.toBe("a@x.com");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://auth.test/api/session/validate/user/sub-1");
    expect(opts.headers["X-Internal-Secret"]).toBe("s3cr3t");
  });

  it("returns null on non-2xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(getAuthEmailBySub("s")).resolves.toBeNull();
  });

  it("returns null when valid:false", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false, error: "user_not_found" }),
    });
    await expect(getAuthEmailBySub("s")).resolves.toBeNull();
  });

  it("returns null when email missing/blank", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, user: {} }),
    });
    await expect(getAuthEmailBySub("s")).resolves.toBeNull();
  });

  it("returns null (fail-open) when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    await expect(getAuthEmailBySub("s")).resolves.toBeNull();
  });
});
