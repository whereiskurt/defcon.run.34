import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRunnerEmail } from "@/lib/runner-email";

/**
 * getRunnerEmail() resolves a bib owner's login email from run.auth's internal
 * validate endpoint, keyed by the OIDC subject. Fail-open: any non-2xx / network
 * error / missing field yields null so the admin CSV download never 500s.
 */

const fetchMock = vi.fn();

describe("getRunnerEmail()", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.AUTH_INTERNAL_URL = "http://auth.test";
    process.env.AUTH_INTERNAL_SECRET = "s3cr3t";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the email from a valid response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, user: { email: "a@x.com" } }),
    });
    await expect(getRunnerEmail("sub-1")).resolves.toBe("a@x.com");
  });

  it("calls run.auth with the internal secret and encoded sub", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, user: { email: "a@x.com" } }),
    });
    await getRunnerEmail("sub/with space");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://auth.test/api/session/validate/user/sub%2Fwith%20space"
    );
    expect(opts.headers["X-Internal-Secret"]).toBe("s3cr3t");
  });

  it("returns null on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(getRunnerEmail("sub-1")).resolves.toBeNull();
  });

  it("returns null when the response is valid:false", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false, error: "user_not_found" }),
    });
    await expect(getRunnerEmail("sub-1")).resolves.toBeNull();
  });

  it("returns null when email is missing or blank", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, user: { email: "" } }),
    });
    await expect(getRunnerEmail("sub-1")).resolves.toBeNull();
  });

  it("returns null (fail-open) when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(getRunnerEmail("sub-1")).resolves.toBeNull();
  });
});
