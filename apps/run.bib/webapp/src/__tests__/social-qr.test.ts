import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSocialQrUrl, getSocialQrHash, getRunnerContact } from "@/lib/social-qr";

/**
 * Social-QR lib unit tests (Plan 34-02, Slice C backend).
 *
 * The bib tear-off QR encodes the runner's real per-user social-QR value —
 * short form `https://q.<SITE_DOMAIN>/r/<token16>` (token16 = first 16 hex of
 * the hash, byte-identical to run.human's buildQrPayload) — where `hash` lives
 * only on run.human's RunUser and is fetched via the internal user endpoint.
 *
 * These tests pin the two invariants a broken cross-app hop must never violate:
 *
 *   1. buildSocialQrUrl produces the exact short `q./r/<token16>` URL shape
 *      from run.bib env (default `defcon.run`, overridable via SITE_DOMAIN;
 *      region-free — the q. resolver owns the region splice).
 *   2. getSocialQrHash is null-safe: it returns the hash when present, null when
 *      absent, and null (never throws) when the fetch rejects — so a QR miss
 *      falls back to the runner-code QR and never 500s the orderform (T-34-07).
 *
 * global `fetch` is stubbed with `vi.fn` so no real cross-app network hop runs.
 */

describe("buildSocialQrUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const HASH =
    "c0ffee5417beefcafe1234567890abcdef1234567890abcdef1234567890abcd";

  it("builds the short q. URL with defaults (defcon.run), region-free", () => {
    vi.stubEnv("SITE_DOMAIN", "");
    vi.stubEnv("REGION_SHORT", "");
    expect(buildSocialQrUrl(HASH)).toBe(
      "https://q.defcon.run/r/c0ffee5417beefca"
    );
    expect(buildSocialQrUrl(HASH)).not.toContain("use1");
  });

  it("respects SITE_DOMAIN override and truncates to 16 chars", () => {
    vi.stubEnv("SITE_DOMAIN", "example.org");
    expect(buildSocialQrUrl(HASH)).toBe(
      "https://q.example.org/r/c0ffee5417beefca"
    );
  });
});

describe("getSocialQrHash", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("resolves the hash string when the endpoint returns one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: "u1", hash: "deadbeef" }),
      })
    );
    await expect(getSocialQrHash("owner-sub-1")).resolves.toBe("deadbeef");
  });

  it("returns null when the endpoint returns no hash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: "u1" }),
      })
    );
    await expect(getSocialQrHash("owner-sub-2")).resolves.toBeNull();
  });

  it("returns null (never throws) when the fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    await expect(getSocialQrHash("owner-sub-3")).resolves.toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "RunUser not found" }),
      })
    );
    await expect(getSocialQrHash("owner-sub-4")).resolves.toBeNull();
  });

  // Regression guard (Kurt 2026-07-05, #3): the internal base MUST come from
  // RUN_HUMAN_INTERNAL_URL — the env the ECS task definition actually sets and
  // the same name run.gpx reads. A prior `HUMAN_INTERNAL_URL` (no RUN_ prefix)
  // never matched, so bib used a wrong fallback host, the hash never resolved,
  // and every bib QR silently fell back to the runner code. The module reads the
  // base at load time, so reset + re-import after stubbing the env.
  it("uses RUN_HUMAN_INTERNAL_URL as the internal base URL", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RUN_HUMAN_INTERNAL_URL", "http://human.internal.test/use1");
    vi.stubEnv("HUMAN_INTERNAL_URL", "http://wrong.example/use1");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "beef" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getSocialQrHash: fresh } = await import("@/lib/social-qr");
    await fresh("sub-x");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://human.internal.test/use1/api/internal/user/sub-x",
      expect.anything()
    );
  });
});

describe("getRunnerContact()", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns hash + email from a 200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "abc123", email: "runner@x.com" }),
    }) as never;
    expect(await getRunnerContact("sub-1")).toEqual({ hash: "abc123", email: "runner@x.com" });
  });

  it("returns nulls on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    expect(await getRunnerContact("sub-1")).toEqual({ hash: null, email: null });
  });

  it("returns nulls (never throws) on a network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as never;
    expect(await getRunnerContact("sub-1")).toEqual({ hash: null, email: null });
  });

  it("nulls missing/blank fields individually", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: "h", email: "" }),
    }) as never;
    expect(await getRunnerContact("sub-1")).toEqual({ hash: "h", email: null });
  });
});
