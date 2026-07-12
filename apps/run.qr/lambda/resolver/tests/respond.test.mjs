/**
 * Tests for lib/respond.mjs — the ALB response builders.
 *
 * These builders are pure: they take plain data and return the ALB
 * Lambda-target integration response shape
 * (`{ statusCode, statusDescription?, headers, body? }`). No AWS, no I/O.
 *
 * The load-bearing behaviors under test:
 *   - NO region injection or URL rewriting — the `Location` is the destination
 *     verbatim (region is the CloudFront edge's job now, not the resolver's);
 *   - every redirect is a 302 with `Cache-Control: no-store`;
 *   - the CTF hand-off URL is a BARE run.defcon.run/ctf/claim (no region
 *     segment) and encodes the submitted value.
 */

import { describe, it, expect } from "vitest";
import { buildRedirect, buildCtfHandoff, notFound } from "../lib/respond.mjs";

describe("buildRedirect", () => {
  it("emits a 302 with Cache-Control: no-store", () => {
    const res = buildRedirect({ destination: "https://example.com/x" });
    expect(res.statusCode).toBe(302);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("passes a non run.defcon.run destination through untouched", () => {
    const dest = "https://example.com/some/path?a=1&b=2#frag";
    const res = buildRedirect({ destination: dest });
    expect(res.headers.Location).toBe(dest);
  });

  it("emits a bare run.defcon.run destination VERBATIM — no region spliced (edge's job)", () => {
    const dest = "https://run.defcon.run/orderform?ref=qr";
    const res = buildRedirect({ destination: dest });
    expect(res.headers.Location).toBe(dest);
  });

  it("does not rewrite a bare run.defcon.run root", () => {
    const dest = "https://run.defcon.run/";
    const res = buildRedirect({ destination: dest });
    expect(res.headers.Location).toBe(dest);
  });

  it("leaves an already-region-prefixed path exactly as-is", () => {
    const dest = "https://run.defcon.run/use1/orderform";
    const res = buildRedirect({ destination: dest });
    expect(res.headers.Location).toBe(dest);
  });

  it("does not touch a lookalike host", () => {
    const dest = "https://run.defcon.run.attacker.com/pwn";
    const res = buildRedirect({ destination: dest });
    expect(res.headers.Location).toBe(dest);
  });

  it("returns a non-absolute destination unchanged (defensive)", () => {
    const res = buildRedirect({ destination: "not a url" });
    expect(res.headers.Location).toBe("not a url");
    expect(res.statusCode).toBe(302);
  });
});

describe("buildCtfHandoff", () => {
  it("hands off to a BARE run.defcon.run/ctf/claim as a 302 no-store (no region segment)", () => {
    const res = buildCtfHandoff({ challenge: "flag1", value: "answer" });
    expect(res.statusCode).toBe(302);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/ctf/claim?c=flag1&v=answer"
    );
  });

  it("URL-encodes the submitted value", () => {
    const res = buildCtfHandoff({ challenge: "flag1", value: "a b&c=d/e" });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/ctf/claim?c=flag1&v=a%20b%26c%3Dd%2Fe"
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
