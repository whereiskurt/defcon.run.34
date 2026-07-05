import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSocialQrUrl, getSocialQrHash } from "@/lib/social-qr";

/**
 * Social-QR lib unit tests (Plan 34-02, Slice C backend).
 *
 * The bib tear-off QR encodes the runner's real per-user social-QR value —
 * `https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>` — where `hash` lives
 * only on run.human's RunUser and is fetched via the internal user endpoint.
 *
 * These tests pin the two invariants a broken cross-app hop must never violate:
 *
 *   1. buildSocialQrUrl produces the exact `/r?h=` URL shape from run.bib env
 *      (defaults `defcon.run` / `use1`, overridable via SITE_DOMAIN/REGION_SHORT).
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

  it("builds the /r?h= URL with defaults (defcon.run / use1)", () => {
    vi.stubEnv("SITE_DOMAIN", "");
    vi.stubEnv("REGION_SHORT", "");
    expect(buildSocialQrUrl("abc123")).toBe(
      "https://run.defcon.run/use1/r?h=abc123"
    );
  });

  it("respects SITE_DOMAIN and REGION_SHORT env overrides", () => {
    vi.stubEnv("SITE_DOMAIN", "example.org");
    vi.stubEnv("REGION_SHORT", "cac1");
    expect(buildSocialQrUrl("xyz789")).toBe(
      "https://run.example.org/cac1/r?h=xyz789"
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
