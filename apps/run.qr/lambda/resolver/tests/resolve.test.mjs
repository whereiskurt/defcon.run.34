/**
 * Tests for lib/resolve.mjs — the resolver orchestration core.
 *
 * `resolve` is driven here with a FAKE `getQr` (no AWS, no DynamoDB) and a
 * capturing `log`, so every branch of the classify → lookup → rules → enrich →
 * respond flow is exercised end-to-end against the real sibling modules
 * (parse-path, rules, enrich, respond, logline).
 *
 * Coverage:
 *   - redirect hit: 302 + Location, with /use1 spliced into run.defcon.run
 *     destinations (other hosts pass through verbatim);
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

  it("splices /use1 into a run.defcon.run destination", async () => {
    const item = { destination: "https://run.defcon.run/orderform", enabled: true };
    const getQr = vi.fn(async () => item);
    const { log } = captureLog();

    const res = await resolve(
      { path: "/ORDER", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.headers.Location).toBe("https://run.defcon.run/use1/orderform");
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

  it("regression: a matching but dest-less time rule falls back to the base (not a 502)", async () => {
    // The exact shape that 502'd in prod: a time rule whose window contains now
    // but whose dest is null. Must redirect to the base destination instead.
    const item = {
      destination: "https://r.defcon.run",
      enabled: true,
      rules: [
        { kind: "time", from: "2026-01-01T00:00:00", to: "2026-12-01T00:00:00", dest: null },
      ],
    };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();

    const res = await resolve({ path: "/RICK", headers: {}, nowMs: NOW }, { getQr, log });

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe("https://r.defcon.run/");
    expect(lines[0]).toMatchObject({ matchedRule: "default", destHost: "r.defcon.run" });
  });

  it("404s (never a broken 302) when the resolved destination has no host", async () => {
    // Base destination itself empty + a dest-less rule → nothing usable. Must be
    // a clean 404, never a 302 with a blank Location.
    const item = {
      destination: "",
      enabled: true,
      rules: [{ kind: "param", match: "*", dest: "" }],
    };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();

    const res = await resolve({ path: "/BROKE?p=1", headers: {}, nowMs: NOW }, { getQr, log });

    expect(res.statusCode).toBe(404);
    expect(lines).toHaveLength(0); // no redirect line emitted for a non-redirect
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
      "https://run.defcon.run/use1/ctf/claim?c=flag1&v=my%20secret%20answer"
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

describe("resolve — award hand-off (/a/<nonce>)", () => {
  const NONCE = "k7m3q9x2wr4t";

  it("302s no-store to the claim page carrying the nonce", async () => {
    const getQr = vi.fn();
    const { log } = captureLog();

    const res = await resolve(
      { path: `/a/${NONCE}`, headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe(
      `https://run.defcon.run/use1/ctf/claim?nonce=${NONCE}`
    );
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("NEVER reads DynamoDB — getQr is not called (cannot fail, throttle or lag)", async () => {
    const getQr = vi.fn();
    const { log } = captureLog();

    await resolve({ path: `/a/${NONCE}`, headers: {}, nowMs: NOW }, { getQr, log });

    expect(getQr).not.toHaveBeenCalled();
  });

  it("LOG HYGIENE: emits ZERO log lines, so the nonce cannot reach CloudWatch", async () => {
    const getQr = vi.fn();
    const { lines, log } = captureLog();

    await resolve({ path: `/a/${NONCE}`, headers: {}, nowMs: NOW }, { getQr, log });

    expect(lines).toHaveLength(0);
    expect(JSON.stringify(lines)).not.toContain(NONCE);
  });

  it("still 302s when getQr would reject — the branch never awaits it", async () => {
    const getQr = vi.fn(async () => {
      throw new Error("dynamo exploded");
    });
    const { log } = captureLog();

    const res = await resolve(
      { path: `/a/${NONCE}`, headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(res.statusCode).toBe(302);
    expect(getQr).not.toHaveBeenCalled();
  });

  it("404s a bare /a (nothing to claim) without touching DynamoDB", async () => {
    const getQr = vi.fn();
    const { lines, log } = captureLog();

    const res = await resolve({ path: "/a", headers: {}, nowMs: NOW }, { getQr, log });

    expect(res.statusCode).toBe(404);
    expect(getQr).not.toHaveBeenCalled();
    expect(lines).toHaveLength(0);
  });

  it("an UPPERCASED link (/A/<NONCE>) still hands off — no DynamoDB read", async () => {
    // A client that upcases the whole URL must still land on the claim page,
    // which lowercases the nonce for lookup. Without a case-insensitive letter
    // this 404s here and that downstream tolerance is dead code.
    const getQr = vi.fn();
    const { lines, log } = captureLog();

    const res = await resolve(
      { path: "/A/K7M3Q9X2WR4T", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(getQr).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/ctf/claim?nonce=K7M3Q9X2WR4T"
    );
    expect(lines).toHaveLength(0);
  });

  it("encodes a metacharacter-bearing nonce rather than forwarding it raw", async () => {
    const getQr = vi.fn();
    const { log } = captureLog();

    const res = await resolve(
      { path: "/a/x&admin=1", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    const url = new URL(res.headers.Location);
    expect([...url.searchParams.keys()]).toEqual(["nonce"]);
    expect(url.searchParams.get("nonce")).toBe("x&admin=1");
  });
});

describe("resolve — live single-letter short codes (regression guard)", () => {
  // Reserving `/a/` must not have disturbed the eight single-letter codes that
  // are already live on q.defcon.run. Each must still reach DynamoDB and 302.
  const LIVE_SINGLE_LETTER_CODES = ["B", "C", "D", "F", "G", "H", "P", "R"];

  it.each(LIVE_SINGLE_LETTER_CODES)(
    "/%s still looks up its code and 302s to the destination",
    async (code) => {
      const item = { destination: `https://example.com/${code}`, enabled: true };
      const getQr = vi.fn(async () => item);
      const { lines, log } = captureLog();

      const res = await resolve(
        { path: `/${code}`, headers: {}, nowMs: NOW },
        { getQr, log }
      );

      expect(getQr).toHaveBeenCalledWith(code);
      expect(res.statusCode).toBe(302);
      expect(res.headers.Location).toBe(`https://example.com/${code}`);
      expect(lines[0]).toMatchObject({ type: "redirect", code });
    }
  );

  it("the lowercase form of each live code resolves identically", async () => {
    for (const code of LIVE_SINGLE_LETTER_CODES) {
      const getQr = vi.fn(async () => ({
        destination: "https://example.com/x",
        enabled: true,
      }));
      const { log } = captureLog();

      const res = await resolve(
        { path: `/${code.toLowerCase()}`, headers: {}, nowMs: NOW },
        { getQr, log }
      );

      expect(getQr).toHaveBeenCalledWith(code);
      expect(res.statusCode).toBe(302);
    }
  });
});

describe("resolve — unfurl (opt-in social card)", () => {
  const SLACK = "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)";
  const HUMAN =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

  it("serves the OG card to a crawler when the code opted into a theme", async () => {
    const item = {
      destination: "https://run.defcon.run/ctf/claim",
      enabled: true,
      unfurl: "cherries",
      enrich: { preserveQuery: true },
    };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();

    const res = await resolve(
      { path: "/C?v=SECRET123", headers: { "user-agent": SLACK }, nowMs: NOW },
      { getQr, log }
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain('property="og:image"');
    expect(res.body).toContain("https://q.defcon.run/_og/cherries.png");
    // Secret-safe: the shared code never appears in the crawler-facing HTML,
    // and the forward URL is the region-prefixed BASE (no query).
    expect(res.body).not.toContain("SECRET123");
    expect(res.body).toContain("https://run.defcon.run/use1/ctf/claim");
    // Crawler prefetch is not a scan.
    expect(lines).toHaveLength(0);
  });

  it("gives a HUMAN the normal 302 WITH the code (unchanged behavior)", async () => {
    const item = {
      destination: "https://run.defcon.run/ctf/claim",
      enabled: true,
      unfurl: "cherries",
      enrich: { preserveQuery: true },
    };
    const getQr = vi.fn(async () => item);
    const { lines, log } = captureLog();

    const res = await resolve(
      { path: "/C?v=SECRET123", headers: { "user-agent": HUMAN }, nowMs: NOW },
      { getQr, log }
    );

    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain("v=SECRET123");
    expect(res.headers.Location).toContain("run.defcon.run/use1/ctf/claim");
    expect(lines).toHaveLength(1); // a real scan IS logged
  });

  it("ignores the theme for a crawler if the code did NOT opt in (plain 302)", async () => {
    const item = { destination: "https://example.com/", enabled: true };
    const getQr = vi.fn(async () => item);
    const { log } = captureLog();

    const res = await resolve(
      { path: "/PLAIN", headers: { "user-agent": SLACK }, nowMs: NOW },
      { getQr, log }
    );

    expect(res.statusCode).toBe(302);
  });

  it("404s a crawler-unfurl only via the same guards (unknown code still 404s)", async () => {
    const getQr = vi.fn(async () => null);
    const { log } = captureLog();
    const res = await resolve(
      { path: "/C?v=X", headers: { "user-agent": SLACK }, nowMs: NOW },
      { getQr, log }
    );
    expect(res.statusCode).toBe(404);
  });
});

describe("resolve — ogimage", () => {
  it("serves the bundled PNG for a known theme", async () => {
    const getQr = vi.fn();
    const { log } = captureLog();

    const res = await resolve(
      { path: "/_og/cherries.png", headers: {}, nowMs: NOW },
      { getQr, log }
    );

    expect(getQr).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(res.isBase64Encoded).toBe(true);
    expect(res.body.startsWith("iVBOR")).toBe(true); // PNG magic
    expect(res.headers["Cache-Control"]).toContain("max-age");
  });

  it("404s an unknown theme", async () => {
    const getQr = vi.fn();
    const { log } = captureLog();
    const res = await resolve(
      { path: "/_og/nope.png", headers: {}, nowMs: NOW },
      { getQr, log }
    );
    expect(res.statusCode).toBe(404);
    expect(getQr).not.toHaveBeenCalled();
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
