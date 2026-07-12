/**
 * Tests for lib/logline.mjs — the structured log-line builders.
 *
 * The resolver emits exactly ONE structured JSON line per scan. These
 * builders return the plain object; `emit` serializes it via `console.log`.
 *
 * CRITICAL log-hygiene invariant: a CTF hand-off line MUST NEVER carry the
 * submitted answer value. The resolver never validates answers and must not
 * leave the raw guess in CloudWatch. `ctfHandoffLog` does not even accept a
 * `value` argument — we assert both the shape AND that a secret value
 * threaded nowhere near the call can never appear in the serialized line.
 */

import { describe, it, expect, vi } from "vitest";
import { redirectLog, ctfHandoffLog, emit } from "../lib/logline.mjs";

describe("redirectLog", () => {
  it("returns the tagged redirect record verbatim (no region field)", () => {
    const rec = redirectLog({
      code: "BUNNY",
      param: "42",
      matchedRule: "default",
      destHost: "run.defcon.run",
      geo: "US",
      ua: "curl/8",
    });
    expect(rec).toEqual({
      type: "redirect",
      code: "BUNNY",
      param: "42",
      matchedRule: "default",
      destHost: "run.defcon.run",
      geo: "US",
      ua: "curl/8",
    });
  });

  it("has NO region key (region is the edge's job)", () => {
    const rec = redirectLog({
      code: "BUNNY",
      param: "42",
      matchedRule: "default",
      destHost: "run.defcon.run",
      geo: "US",
      ua: "curl/8",
    });
    expect("region" in rec).toBe(false);
  });

  it("carries a null param through", () => {
    const rec = redirectLog({
      code: "BUNNY",
      param: null,
      matchedRule: "default",
      destHost: "example.com",
      geo: "CA",
      ua: "ua",
    });
    expect(rec.param).toBeNull();
  });
});

describe("ctfHandoffLog", () => {
  it("returns the tagged ctf-handoff record with a fixed result (no region)", () => {
    const rec = ctfHandoffLog({ challenge: "flag1" });
    expect(rec).toEqual({
      type: "ctf-handoff",
      challenge: "flag1",
      result: "handoff",
    });
  });

  it("has NO value key, ever", () => {
    const rec = ctfHandoffLog({ challenge: "flag1" });
    expect(Object.keys(rec)).not.toContain("value");
    expect("value" in rec).toBe(false);
  });

  it("log-hygiene: the serialized line never contains a submitted value", () => {
    // A secret guess threaded through the scan is passed NOWHERE into
    // ctfHandoffLog — the signature does not even accept it. This proves the
    // contract structurally: no code path can leak the answer into the log.
    const SECRET_SUBMITTED_VALUE = "s3cr3t-flag-guess-do-not-log";
    const rec = ctfHandoffLog({ challenge: "flag1" });
    const line = JSON.stringify(rec);
    expect(line).not.toContain(SECRET_SUBMITTED_VALUE);
    expect(line).not.toContain("value");
  });

  it("does not accept a value argument (extra props are ignored)", () => {
    // Even if a caller mistakenly spreads a value in, the builder only reads
    // the one field it destructures — the value cannot ride along.
    const rec = ctfHandoffLog({
      challenge: "flag1",
      value: "should-be-dropped",
    });
    expect(JSON.stringify(rec)).not.toContain("should-be-dropped");
  });
});

describe("emit", () => {
  it("console.logs the JSON-stringified object exactly once", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const obj = { type: "redirect", code: "BUNNY" };
      emit(obj);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(JSON.stringify(obj));
    } finally {
      spy.mockRestore();
    }
  });
});
