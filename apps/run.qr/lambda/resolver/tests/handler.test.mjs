/**
 * Tests for index.mjs — the ALB target handler shim.
 *
 * `index.mjs` imports the real `entities.mjs`, which constructs a DynamoDB
 * Document client at module load. That construction does NO network I/O, so
 * importing the module is safe. To exercise the handler without AWS we use the
 * exported `_buildHandler({ getQr })` factory and inject a fake per-code fetch.
 *
 * Coverage:
 *   - ALB path reconstruction (bare path, and path + rebuilt/encoded query);
 *   - the reconstructed target flows through the real resolver to an ALB
 *     response (302 / 404);
 *   - the warm cache: a second scan of the same code within TTL does NOT call
 *     the underlying fetch again; an expired entry re-fetches;
 *   - negative caching: a `null` miss is cached (no repeat fetch within TTL).
 */

import { describe, it, expect, vi } from "vitest";
import { _buildHandler, CACHE_TTL_MS } from "../index.mjs";

// Minimal ALB event factory.
function albEvent({ path = "/", queryStringParameters = null, headers = {} } = {}) {
  return { path, queryStringParameters, headers };
}

describe("handler — path reconstruction", () => {
  it("resolves a bare code path to a 302 and fetches by UPPERCASED code", async () => {
    const getQr = vi.fn(async () => ({
      destination: "https://example.com/x",
      enabled: true,
    }));
    const handler = _buildHandler({ getQr });

    const res = await handler(albEvent({ path: "/bunny" }));

    expect(getQr).toHaveBeenCalledWith("BUNNY");
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe("https://example.com/x");
  });

  it("rebuilds and URL-encodes the query string from queryStringParameters", async () => {
    // enrich.preserveQuery lets us observe that the rebuilt query reached the
    // resolver intact (including a value needing percent-encoding).
    const getQr = vi.fn(async () => ({
      destination: "https://example.com/landing",
      enabled: true,
      enrich: { preserveQuery: true },
    }));
    const handler = _buildHandler({ getQr });

    const res = await handler(
      albEvent({
        path: "/promo",
        queryStringParameters: { utm_source: "poster board", ref: "a&b" },
      })
    );

    const loc = new URL(res.headers.Location);
    expect(loc.searchParams.get("utm_source")).toBe("poster board");
    expect(loc.searchParams.get("ref")).toBe("a&b");
  });

  it("404s an unknown code", async () => {
    const getQr = vi.fn(async () => null);
    const handler = _buildHandler({ getQr });

    const res = await handler(albEvent({ path: "/missing" }));

    expect(res.statusCode).toBe(404);
  });

  it("defaults a missing event.path to the empty root → 404", async () => {
    const getQr = vi.fn();
    const handler = _buildHandler({ getQr });

    const res = await handler({});

    expect(res.statusCode).toBe(404);
    expect(getQr).not.toHaveBeenCalled();
  });
});

describe("handler — warm cache", () => {
  it("serves a second scan of the same code from cache (no second fetch)", async () => {
    const getQr = vi.fn(async () => ({
      destination: "https://example.com/x",
      enabled: true,
    }));
    const handler = _buildHandler({ getQr });

    await handler(albEvent({ path: "/hot" }));
    await handler(albEvent({ path: "/hot" }));

    expect(getQr).toHaveBeenCalledTimes(1);
  });

  it("caches a null miss too — a bogus code is fetched only once within TTL", async () => {
    const getQr = vi.fn(async () => null);
    const handler = _buildHandler({ getQr });

    const a = await handler(albEvent({ path: "/bogus" }));
    const b = await handler(albEvent({ path: "/bogus" }));

    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    expect(getQr).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the TTL expires", async () => {
    const getQr = vi.fn(async () => ({
      destination: "https://example.com/x",
      enabled: true,
    }));
    // Controllable clock: first call t=0, later calls past the TTL.
    let t = 0;
    const handler = _buildHandler({ getQr, now: () => t });

    await handler(albEvent({ path: "/aging" })); // populates cache at t=0
    t = CACHE_TTL_MS + 1; // advance past expiry
    await handler(albEvent({ path: "/aging" }));

    expect(getQr).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by code — different codes each fetch", async () => {
    const getQr = vi.fn(async (code) => ({
      destination: `https://example.com/${code}`,
      enabled: true,
    }));
    const handler = _buildHandler({ getQr });

    await handler(albEvent({ path: "/one" }));
    await handler(albEvent({ path: "/two" }));

    expect(getQr).toHaveBeenCalledTimes(2);
    expect(getQr).toHaveBeenCalledWith("ONE");
    expect(getQr).toHaveBeenCalledWith("TWO");
  });
});
