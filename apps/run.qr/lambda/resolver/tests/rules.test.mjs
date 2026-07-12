import { describe, it, expect } from "vitest";
import { resolveDestination } from "../lib/rules.mjs";

const T0 = Date.parse("2026-08-06T18:00:00Z"); // reference "now"

describe("resolveDestination — fallback", () => {
  it("returns the base destination and 'default' when there are no rules", () => {
    const item = { destination: "https://a.example/" };
    expect(resolveDestination(item, { param: null, nowMs: T0 })).toEqual({
      destination: "https://a.example/",
      matchedRule: "default",
    });
  });

  it("falls back when rules exist but none match", () => {
    const item = {
      destination: "https://base.example/",
      rules: [
        { kind: "param", match: "42", dest: "https://p.example/" },
      ],
    };
    const r = resolveDestination(item, { param: "99", nowMs: T0 });
    expect(r.destination).toBe("https://base.example/");
    expect(r.matchedRule).toBe("default");
  });
});

describe("resolveDestination — time rules", () => {
  const timeRule = {
    kind: "time",
    from: "2026-08-06T00:00:00Z",
    to: "2026-08-07T00:00:00Z",
    dest: "https://event.example/",
  };

  it("matches when now is inside [from, to)", () => {
    const item = { destination: "https://base/", rules: [timeRule] };
    const r = resolveDestination(item, { param: null, nowMs: T0 });
    expect(r.destination).toBe("https://event.example/");
    expect(r.matchedRule).toBe(timeRule);
  });

  it("does NOT match at the exact 'to' boundary (half-open)", () => {
    const item = { destination: "https://base/", rules: [timeRule] };
    const nowMs = Date.parse("2026-08-07T00:00:00Z");
    expect(resolveDestination(item, { param: null, nowMs }).matchedRule).toBe(
      "default"
    );
  });

  it("matches at the exact 'from' boundary (inclusive)", () => {
    const item = { destination: "https://base/", rules: [timeRule] };
    const nowMs = Date.parse("2026-08-06T00:00:00Z");
    expect(resolveDestination(item, { param: null, nowMs }).matchedRule).toBe(
      timeRule
    );
  });

  it("does not match when now is before the window", () => {
    const item = { destination: "https://base/", rules: [timeRule] };
    const nowMs = Date.parse("2026-08-05T23:59:59Z");
    expect(resolveDestination(item, { param: null, nowMs }).matchedRule).toBe(
      "default"
    );
  });

  it("takes the first matching time rule in array order", () => {
    const first = {
      kind: "time",
      from: "2026-08-06T00:00:00Z",
      to: "2026-08-07T00:00:00Z",
      dest: "https://first/",
    };
    const second = {
      kind: "time",
      from: "2026-08-06T12:00:00Z",
      to: "2026-08-06T20:00:00Z",
      dest: "https://second/",
    };
    const item = { destination: "https://base/", rules: [first, second] };
    expect(resolveDestination(item, { param: null, nowMs: T0 }).dest).toBe(
      undefined
    );
    expect(
      resolveDestination(item, { param: null, nowMs: T0 }).matchedRule
    ).toBe(first);
  });
});

describe("resolveDestination — precedence: time beats param", () => {
  it("an active time rule wins even when a param rule also matches", () => {
    const time = {
      kind: "time",
      from: "2026-08-06T00:00:00Z",
      to: "2026-08-07T00:00:00Z",
      dest: "https://time/",
    };
    const param = { kind: "param", match: "42", dest: "https://param/" };
    const item = { destination: "https://base/", rules: [param, time] };
    const r = resolveDestination(item, { param: "42", nowMs: T0 });
    expect(r.destination).toBe("https://time/");
    expect(r.matchedRule).toBe(time);
  });
});

describe("resolveDestination — param rules", () => {
  it("matches an exact param", () => {
    const rule = { kind: "param", match: "42", dest: "https://p42/" };
    const item = { destination: "https://base/", rules: [rule] };
    const r = resolveDestination(item, { param: "42", nowMs: T0 });
    expect(r.destination).toBe("https://p42/");
    expect(r.matchedRule).toBe(rule);
  });

  it("coerces param to string before comparing", () => {
    const rule = { kind: "param", match: "42", dest: "https://p42/" };
    const item = { destination: "https://base/", rules: [rule] };
    expect(resolveDestination(item, { param: 42, nowMs: T0 }).destination).toBe(
      "https://p42/"
    );
  });

  it("'*' matches any non-null param", () => {
    const rule = { kind: "param", match: "*", dest: "https://wild/" };
    const item = { destination: "https://base/", rules: [rule] };
    expect(
      resolveDestination(item, { param: "anything", nowMs: T0 }).destination
    ).toBe("https://wild/");
  });

  it("'*' does NOT match when param is null (falls back)", () => {
    const rule = { kind: "param", match: "*", dest: "https://wild/" };
    const item = { destination: "https://base/", rules: [rule] };
    expect(
      resolveDestination(item, { param: null, nowMs: T0 }).matchedRule
    ).toBe("default");
  });

  it("takes the first matching param rule (exact before wildcard by order)", () => {
    const wild = { kind: "param", match: "*", dest: "https://wild/" };
    const exact = { kind: "param", match: "42", dest: "https://exact/" };
    const item = { destination: "https://base/", rules: [exact, wild] };
    expect(
      resolveDestination(item, { param: "42", nowMs: T0 }).destination
    ).toBe("https://exact/");
  });
});
