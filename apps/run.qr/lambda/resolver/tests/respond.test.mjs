/**
 * Tests for lib/respond.mjs — the ALB response builders.
 *
 * These builders are pure: they take plain data and return the ALB
 * Lambda-target integration response shape
 * (`{ statusCode, statusDescription?, headers, body? }`). No AWS, no I/O.
 *
 * The load-bearing behaviors under test:
 *   - run.defcon.run destinations get `/use1` spliced in (only region that
 *     serves today); every other host is emitted verbatim;
 *   - splicing is idempotent (an already-region-prefixed path is left alone)
 *     and host-exact (lookalikes untouched);
 *   - every redirect is a 302 with `Cache-Control: no-store`;
 *   - the CTF hand-off URL is region-prefixed run.defcon.run/use1/ctf/claim and
 *     encodes the submitted value.
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

  it("splices /use1 into a bare run.defcon.run destination, preserving query", () => {
    const res = buildRedirect({
      destination: "https://run.defcon.run/orderform?ref=qr",
    });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/orderform?ref=qr"
    );
  });

  it("splices /use1 into a bare run.defcon.run root", () => {
    const res = buildRedirect({ destination: "https://run.defcon.run/" });
    expect(res.headers.Location).toBe("https://run.defcon.run/use1");
  });

  it("leaves an already-region-prefixed path exactly as-is (idempotent)", () => {
    const dest = "https://run.defcon.run/use1/orderform";
    const res = buildRedirect({ destination: dest });
    expect(res.headers.Location).toBe(dest);
  });

  it("does not double-prefix cac1/apse1 paths either", () => {
    for (const dest of [
      "https://run.defcon.run/cac1/x",
      "https://run.defcon.run/apse1/y",
    ]) {
      expect(buildRedirect({ destination: dest }).headers.Location).toBe(dest);
    }
  });

  it("does not touch a lookalike host", () => {
    const dest = "https://run.defcon.run.attacker.com/pwn";
    const res = buildRedirect({ destination: dest });
    expect(res.headers.Location).toBe(dest);
  });

  it("does not treat a /use1234 segment as an existing region prefix", () => {
    const res = buildRedirect({
      destination: "https://run.defcon.run/use1234/x",
    });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/use1234/x"
    );
  });

  it("returns a non-absolute destination unchanged (defensive)", () => {
    const res = buildRedirect({ destination: "not a url" });
    expect(res.headers.Location).toBe("not a url");
    expect(res.statusCode).toBe(302);
  });
});

describe("buildCtfHandoff", () => {
  it("hands off to run.defcon.run/use1/ctf/claim as a 302 no-store", () => {
    const res = buildCtfHandoff({ challenge: "flag1", value: "answer" });
    expect(res.statusCode).toBe(302);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/ctf/claim?c=flag1&v=answer"
    );
  });

  it("URL-encodes the submitted value", () => {
    const res = buildCtfHandoff({ challenge: "flag1", value: "a b&c=d/e" });
    expect(res.headers.Location).toBe(
      "https://run.defcon.run/use1/ctf/claim?c=flag1&v=a%20b%26c%3Dd%2Fe"
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
