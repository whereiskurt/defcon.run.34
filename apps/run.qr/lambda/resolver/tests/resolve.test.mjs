/**
 * Tests for lib/resolve.mjs — the resolver orchestration core.
 *
 * `resolve` is driven here with a FAKE `getQr` (no AWS, no DynamoDB) and a
 * capturing `log`, so every branch of the classify → lookup → rules → enrich →
 * respond flow is exercised end-to-end against the real sibling modules
 * (parse-path, rules, enrich, respond, logline).
 *
 * Coverage:
 *   - redirect hit: 302 + Location emitted VERBATIM (region is the edge's job,
 *     the resolver never rewrites the destination);
 *   - miss (getQr → null) → 404;
 *   - disabled (enabled:false) → 404;
 *   - time-rule and param-rule selection end-to-end;
 *   - CTF hand-off: 302 + BARE claim URL (no region segment), value encoded;
 *   - LOG HYGIENE: the emitted CTF log line never contains the submitted value;
 *   - a rejecting getQr never throws (degrades to 404).
 */

import { describe, it, expect, vi } from "vitest";
import { resolve } from "../lib/resolve.mjs";

// A tiny capturing log sink: records every emitted object.
function captureLog() {
  const lines = [];
  const log = (obj) => lines.push(obj);
  return { lines, log };
}

// nowMs anchored well outside any time window unless a test opts in.
const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("resolve — redirect", () => {
  it("302s to the item destination and logs a redirect line (no region field)", async () => {
    const item = { destination: "https://example.com/landing", enabled: true };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();

    const res = await resolve(
      { path: "/BUNNY", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(getQr).toHaveBeenCalledWith("BUNNY");
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe("https://example.com/landing");
    expect(res.headers["Cache-Control"]).toBe("no-store");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      type: "redirect",
      code: "BUNNY",
      param: null,
      matchedRule: "default",
      destHost: "example.com",
    });
    expect("region" in lines[0]).toBe(false);
  });

  it("emits a bare run.defcon.run destination VERBATIM — no region spliced (edge's job)", async () => {
    const item = { destination: "https://run.defcon.run/orderform", enabled: true };
    const getQr = vi.fn(async () => item);
    const { log } = captureLog();

    const res = await resolve(
      { path: "/ORDER", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.headers.Location).toBe("https://run.defcon.run/orderform");
  });

  it("carries ua + geo headers onto the redirect log line", async () => {
    const item = { destination: "https://example.com/", enabled: true };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();

    await resolve(
      {
        path: "/X",
        headers: { "user-agent": "curl/8", "cloudfront-viewer-country": "CA" },
        nowMs: NOW,
      },
      { getQr, log }
    );

    expect(lines[0]).toMatchObject({ ua: "curl/8", geo: "CA" });
  });

  it("404s on an unknown code (getQr → null) and does not log a redirect", async () => {
    const getQr = vi.fn(async () => null);
    const { lines, log } = captureLog();

    const res = await resolve(
      { path: "/NOPE", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.statusCode).toBe(404);
    expect(lines).toHaveLength(0);
  });

  it("404s on a disabled code (enabled:false)", async () => {
    const item = { destination: "https://example.com/", enabled: false };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();

    const res = await resolve(
      { path: "/OFF", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.statusCode).toBe(404);
    expect(lines).toHaveLength(0);
  });

  it("never throws when getQr rejects — degrades to 404", async () => {
    const getQr = vi.fn(async () => {
      throw new Error("dynamo exploded");
    });
    const { log } = captureLog();

    const res = await resolve(
      { path: "/BOOM", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.statusCode).toBe(404);
  });
});

describe("resolve — rule selection end-to-end", () => {
  it("selects an active TIME rule destination", async () => {
    const item = {
      destination: "https://example.com/base",
      enabled: true,
      rules: [
        {
          kind: "time",
          from: "2026-08-01T00:00:00Z",
          to: "2026-08-10T00:00:00Z",
          dest: "https://example.com/con",
        },
      ],
    };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();
    const during = Date.parse("2026-08-05T12:00:00Z");

    const res = await resolve(
      { path: "/EVT", headers: {}, nowMs: during },
      { getQr, log }
    );

    expect(res.headers.Location).toBe("https://example.com/con");
    expect(lines[0].matchedRule).toMatchObject({ kind: "time" });
  });

  it("falls back to the base destination when the time window is closed", async () => {
    const item = {
      destination: "https://example.com/base",
      enabled: true,
      rules: [
        {
          kind: "time",
          from: "2026-08-01T00:00:00Z",
          to: "2026-08-10T00:00:00Z",
          dest: "https://example.com/con",
        },
      ],
    };
    const getQr = vi.fn(async () => item);
    const { log } = captureLog();

    const res = await resolve(
      { path: "/EVT", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.headers.Location).toBe("https://example.com/base");
  });

  it("selects a PARAM rule by the second path segment", async () => {
    const item = {
      destination: "https://example.com/base",
      enabled: true,
      rules: [
        { kind: "param", match: "vip", dest: "https://example.com/vip" },
      ],
    };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();

    const res = await resolve(
      { path: "/TIER/vip", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.headers.Location).toBe("https://example.com/vip");
    expect(lines[0]).toMatchObject({ param: "vip", matchedRule: { match: "vip" } });
  });

  it("preserves the incoming query and appends the param when enrich asks", async () => {
    const item = {
      destination: "https://example.com/landing",
      enabled: true,
      enrich: { preserveQuery: true, appendParam: true },
    };
    const getQr = vi.fn(async () => item);
    const { log } = captureLog();

    const res = await resolve(
      { path: "/PROMO/42?utm_source=poster", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    const loc = new URL(res.headers.Location);
    expect(loc.searchParams.get("utm_source")).toBe("poster");
    expect(loc.searchParams.get("p")).toBe("42");
  });
});

describe("resolve — ctf hand-off", () => {
  it("302s to a BARE claim URL (no region segment) with the encoded value", async () => {
    const getQr = vi.fn();
    const { lines, log } = captureLog();

    const res = await resolve(
      { path: "/ctf/flag1/my secret answer", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(getQr).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/ctf/claim?c=flag1&v=my%20secret%20answer"
    );
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("LOG HYGIENE: the emitted ctf line never contains the submitted value", async () => {
    const getQr = vi.fn();
    const { lines, log } = captureLog();
    const secret = "SUPERSECRETGUESS-42";

    await resolve(
      { path: `/ctf/flag1/${secret}`, headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      type: "ctf-handoff",
      challenge: "flag1",
      result: "handoff",
    });
    // Neither the object nor its serialized form may leak the guess.
    expect(lines[0]).not.toHaveProperty("value");
    expect(JSON.stringify(lines[0])).not.toContain(secret);
  });
});

describe("resolve — empty / flush", () => {
  it("404s the bare root", async () => {
    const getQr = vi.fn();
    const { log } = captureLog();
    const res = await resolve({ path: "/", headers: {}, nowMs: NOW }, { getQr, log });
    expect(res.statusCode).toBe(404);
    expect(getQr).not.toHaveBeenCalled();
  });

  it("404s the reserved _flush trigger (rollup owns it, not the resolver)", async () => {
    const getQr = vi.fn();
    const { log } = captureLog();
    const res = await resolve(
      { path: "/_flush", headers: {}, nowMs: NOW },
      { getQr, log }
    );
    expect(res.statusCode).toBe(404);
    expect(getQr).not.toHaveBeenCalled();
  });
});
