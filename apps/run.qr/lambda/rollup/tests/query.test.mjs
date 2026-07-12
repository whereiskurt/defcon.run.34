import { describe, it, expect } from "vitest";
import { buildInsightsQuery, parseResultRows } from "../lib/query.mjs";

describe("buildInsightsQuery", () => {
  it("returns a string selecting @message and @timestamp", () => {
    const q = buildInsightsQuery({ sinceMs: 1000, untilMs: 2000 });
    expect(typeof q).toBe("string");
    expect(q).toMatch(/@message/);
    expect(q).toMatch(/@timestamp/);
  });

  it("sorts ascending and imposes a generous limit", () => {
    const q = buildInsightsQuery({ sinceMs: 0, untilMs: 1 });
    expect(q).toMatch(/sort\s+@timestamp\s+asc/i);
    expect(q).toMatch(/limit\s+\d+/i);
  });
});

describe("parseResultRows", () => {
  const row = (msg, ts) => [
    { field: "@timestamp", value: ts },
    { field: "@message", value: msg },
    { field: "@ptr", value: "cursor" },
  ];

  it("parses @message JSON and attaches _ts (ms) from a GetQueryResults response", () => {
    const results = {
      results: [
        row(JSON.stringify({ type: "redirect", code: "BUNNY", param: "42" }), "2026-07-12 00:00:00.000"),
      ],
    };
    const out = parseResultRows(results);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("redirect");
    expect(out[0].code).toBe("BUNNY");
    expect(out[0]._ts).toBe(Date.parse("2026-07-12T00:00:00.000Z"));
  });

  it("accepts a bare results array and numeric-string timestamps", () => {
    const out = parseResultRows([row(JSON.stringify({ type: "redirect", code: "X" }), "1752278400000")]);
    expect(out).toHaveLength(1);
    expect(out[0]._ts).toBe(1752278400000);
  });

  it("skips rows with unparseable @message or no @message", () => {
    const out = parseResultRows({
      results: [
        row("not-json{", "2026-07-12 00:00:00.000"),
        row(JSON.stringify({ type: "redirect", code: "OK" }), "2026-07-12 00:00:00.000"),
        [{ field: "@timestamp", value: "2026-07-12 00:00:00.000" }],
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe("OK");
  });

  it("tolerates empty / missing results", () => {
    expect(parseResultRows({ results: [] })).toEqual([]);
    expect(parseResultRows(undefined)).toEqual([]);
  });
});
