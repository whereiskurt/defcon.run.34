/**
 * Tests for lib/respond.mjs — the ALB response builders.
 *
 * These builders are pure: they take plain data and return the ALB
 * Lambda-target integration response shape
 * (`{ statusCode, statusDescription?, headers, body? }`). No AWS, no I/O.
 *
 * The load-bearing behaviors under test:
 *   - region injection ONLY for `run.defcon.run` destinations that don't
 *     already carry a `/use1` or `/cac1` prefix (everything else passes
 *     through byte-for-byte);
 *   - every redirect is a 302 with `Cache-Control: no-store`;
 *   - the CTF hand-off URL encodes the submitted value;
 *   - `resolveRegion` defaults to `use1` and only flips to `cac1` on an
 *     exact `"cac1"` hint.
 */

import { describe, it, expect } from "vitest";
import {
  resolveRegion,
  buildRedirect,
  buildCtfHandoff,
  notFound,
} from "../lib/respond.mjs";

describe("resolveRegion", () => {
  it("defaults to use1 when the hint is undefined", () => {
    expect(resolveRegion(undefined)).toBe("use1");
  });

  it("defaults to use1 for an unknown hint", () => {
    expect(resolveRegion("eu-west-1")).toBe("use1");
    expect(resolveRegion("")).toBe("use1");
    expect(resolveRegion(null)).toBe("use1");
  });

  it("returns cac1 ONLY for an exact 'cac1' hint", () => {
    expect(resolveRegion("cac1")).toBe("cac1");
  });

  it("does not treat near-misses as cac1", () => {
    expect(resolveRegion("CAC1")).toBe("use1");
    expect(resolveRegion("cac1 ")).toBe("use1");
    expect(resolveRegion("ca-central-1")).toBe("use1");
  });
});

describe("buildRedirect", () => {
  it("emits a 302 with Cache-Control: no-store", () => {
    const res = buildRedirect({ destination: "https://example.com/x" });
    expect(res.statusCode).toBe(302);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("passes a non run.defcon.run destination through untouched", () => {
    const dest = "https://example.com/some/path?a=1&b=2#frag";
    const res = buildRedirect({ destination: dest, region: "use1" });
    expect(res.headers.Location).toBe(dest);
  });

  it("does not inject a region for a lookalike host", () => {
    // `evil-run.defcon.run.attacker.com` must NOT be treated as our host.
    const dest = "https://run.defcon.run.attacker.com/pwn";
    const res = buildRedirect({ destination: dest, region: "use1" });
    expect(res.headers.Location).toBe(dest);
  });

  it("injects /use1 right after the run.defcon.run host, preserving path+query", () => {
    const res = buildRedirect({
      destination: "https://run.defcon.run/orderform?ref=qr",
      region: "use1",
    });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/orderform?ref=qr"
    );
  });

  it("injects /cac1 when the region is cac1", () => {
    const res = buildRedirect({
      destination: "https://run.defcon.run/profile",
      region: "cac1",
    });
    expect(res.headers.Location).toBe("https://run.defcon.run/cac1/profile");
  });

  it("injects the region for a bare run.defcon.run root", () => {
    const res = buildRedirect({
      destination: "https://run.defcon.run/",
      region: "use1",
    });
    expect(res.headers.Location).toBe("https://run.defcon.run/use1/");
  });

  it("does NOT double-inject when the path already starts with /use1", () => {
    const dest = "https://run.defcon.run/use1/orderform";
    const res = buildRedirect({ destination: dest, region: "use1" });
    expect(res.headers.Location).toBe(dest);
  });

  it("does NOT double-inject when the path already starts with /cac1", () => {
    const dest = "https://run.defcon.run/cac1/profile?x=1";
    const res = buildRedirect({ destination: dest, region: "use1" });
    expect(res.headers.Location).toBe(dest);
  });

  it("treats /use1234 as a distinct segment and still injects", () => {
    // A path that merely starts with the letters "use1" but is a different
    // segment must still get the region prefix.
    const res = buildRedirect({
      destination: "https://run.defcon.run/use1234/thing",
      region: "use1",
    });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/use1234/thing"
    );
  });

  it("defaults the region to use1 when omitted", () => {
    const res = buildRedirect({ destination: "https://run.defcon.run/x" });
    expect(res.headers.Location).toBe("https://run.defcon.run/use1/x");
  });

  it("returns a non-absolute destination unchanged (defensive)", () => {
    const res = buildRedirect({ destination: "not a url", region: "use1" });
    expect(res.headers.Location).toBe("not a url");
    expect(res.statusCode).toBe(302);
  });
});

describe("buildCtfHandoff", () => {
  it("hands off to run.defcon.run/<region>/ctf/claim as a 302 no-store", () => {
    const res = buildCtfHandoff({
      challenge: "flag1",
      value: "answer",
      region: "use1",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/ctf/claim?c=flag1&v=answer"
    );
  });

  it("uses the cac1 region segment when asked", () => {
    const res = buildCtfHandoff({
      challenge: "flag1",
      value: "answer",
      region: "cac1",
    });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/cac1/ctf/claim?c=flag1&v=answer"
    );
  });

  it("URL-encodes the submitted value", () => {
    const res = buildCtfHandoff({
      challenge: "flag1",
      value: "a b&c=d/e",
      region: "use1",
    });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/ctf/claim?c=flag1&v=a%20b%26c%3Dd%2Fe"
    );
  });

  it("defaults the region to use1 when omitted", () => {
    const res = buildCtfHandoff({ challenge: "flag1", value: "x" });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/ctf/claim?c=flag1&v=x"
    );
  });
});

describe("notFound", () => {
  it("returns a 404 with a small text body", () => {
    const res = notFound();
    expect(res.statusCode).toBe(404);
    expect(typeof res.body).toBe("string");
    expect(res.body.length).toBeGreaterThan(0);
  });
});
