import { afterEach, describe, expect, it, vi } from "vitest";
import { interpolate, t } from "@/lib/copy-core";
import { resolveCopy } from "@/lib/copy";

/**
 * Copy toolkit unit tests (Phase 36-01).
 *
 * Two modules under test:
 *   - copy-core.ts (client-safe, pure): `interpolate` + `t` — an in-memory O(1)
 *     lookup with no network. Plan 03's client provider imports the SAME path.
 *   - copy.ts (server-only): `resolveCopy` — the cached-resolver test seam. Merges
 *     Strapi (wins) over the S3 export over the committed snapshot floor, catching
 *     every layer independently so it NEVER throws.
 *
 * global `fetch` is stubbed with vi.fn (routed by URL) and env is driven with
 * vi.stubEnv, mirroring social-qr.test.ts. We exercise resolveCopy directly (not
 * the unstable_cache-wrapped loadCopy) to avoid Next request-scope coupling.
 */

describe("copy-core: interpolate", () => {
  it("replaces every {placeholder} token from vars", () => {
    expect(interpolate("Hi {name}, you owe {amount}", { name: "Ada", amount: 5 })).toBe(
      "Hi Ada, you owe 5"
    );
  });

  it("leaves unmatched tokens intact", () => {
    expect(interpolate("Hello {name} {missing}", { name: "Ada" })).toBe(
      "Hello Ada {missing}"
    );
  });

  it("returns the value unchanged when no vars are given", () => {
    expect(interpolate("plain text")).toBe("plain text");
  });
});

describe("copy-core: t", () => {
  const map = {
    "bib.selftest.clientGreeting": "Hello {name}",
    "bib.donate.title": "Donate",
  };

  it("looks up + interpolates a present key", () => {
    expect(t(map, "bib.selftest.clientGreeting", { name: "Ada" })).toBe("Hello Ada");
  });

  it("echoes the key itself as the last resort for a missing key", () => {
    expect(t(map, "missing.key")).toBe("missing.key");
  });

  it("is a pure lookup with no interpolation surprises", () => {
    expect(t(map, "bib.donate.title")).toBe("Donate");
  });
});

const SNAPSHOT_KEY = "bib.selftest.serverGreeting";
const SNAPSHOT_VALUE = "Bib copy toolkit online";

function strapiResponse(rows: Array<{ key: string; value: string }>) {
  return {
    ok: true,
    json: async () => ({
      data: rows.map((r) => ({ ...r, locale: "default" })),
      meta: { pagination: { page: 1, pageCount: 1, total: rows.length } },
    }),
  };
}

function s3Response(map: Record<string, string>) {
  return {
    ok: true,
    json: async () => ({ default: map }),
  };
}

function routeFetch(handlers: {
  strapi?: () => unknown;
  s3?: () => unknown;
}) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/ui-strings")) {
      if (!handlers.strapi) throw new Error("no strapi");
      return handlers.strapi();
    }
    if (url.includes("/cms/copy.json")) {
      if (!handlers.s3) throw new Error("no s3");
      return handlers.s3();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("copy.ts: resolveCopy fallback chain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("merges Strapi over S3 over the committed snapshot", async () => {
    vi.stubEnv("CMS_INTERNAL_URL", "http://cms.internal");
    vi.stubEnv("STRAPI_API_TOKEN", "tok");
    vi.stubGlobal(
      "fetch",
      routeFetch({
        strapi: () =>
          strapiResponse([{ key: "merge.key", value: "strapi" }]),
        s3: () => s3Response({ "merge.key": "s3", "s3.only": "fromS3" }),
      })
    );

    const map = await resolveCopy("default");
    expect(map["merge.key"]).toBe("strapi"); // Strapi wins
    expect(map["s3.only"]).toBe("fromS3"); // S3-only key survives
    expect(map[SNAPSHOT_KEY]).toBe(SNAPSHOT_VALUE); // snapshot floor present
  });

  it("falls through to S3 when the Strapi fetch rejects, never throwing", async () => {
    vi.stubEnv("CMS_INTERNAL_URL", "http://cms.internal");
    vi.stubEnv("STRAPI_API_TOKEN", "tok");
    vi.stubGlobal(
      "fetch",
      routeFetch({
        strapi: () => {
          throw new Error("strapi down");
        },
        s3: () => s3Response({ "s3.only": "fromS3" }),
      })
    );

    const map = await resolveCopy("default");
    expect(map["s3.only"]).toBe("fromS3");
    expect(map[SNAPSHOT_KEY]).toBe(SNAPSHOT_VALUE);
  });

  it("falls through to the committed snapshot when Strapi AND S3 both fail", async () => {
    vi.stubEnv("CMS_INTERNAL_URL", "http://cms.internal");
    vi.stubEnv("STRAPI_API_TOKEN", "tok");
    vi.stubGlobal(
      "fetch",
      routeFetch({
        strapi: () => {
          throw new Error("strapi down");
        },
        s3: () => {
          throw new Error("s3 down");
        },
      })
    );

    const map = await resolveCopy("default");
    expect(map[SNAPSHOT_KEY]).toBe(SNAPSHOT_VALUE);
    // A snapshot-present key must never render as a raw dotted key (FALL-04).
    expect(map[SNAPSHOT_KEY]).not.toBe(SNAPSHOT_KEY);
  });

  it("skips Strapi (no token) and still resolves from S3 without throwing", async () => {
    vi.stubEnv("CMS_INTERNAL_URL", "");
    vi.stubEnv("STRAPI_API_TOKEN", "");
    const fetchMock = routeFetch({
      s3: () => s3Response({ "s3.only": "fromS3" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const map = await resolveCopy("default");
    expect(map["s3.only"]).toBe("fromS3");
    // Strapi endpoint must not be called when CMS env is absent.
    const calledStrapi = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes("/api/ui-strings")
    );
    expect(calledStrapi).toBe(false);
  });
});
