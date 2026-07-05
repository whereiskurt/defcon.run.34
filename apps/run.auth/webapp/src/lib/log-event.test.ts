import { describe, it, expect, vi } from "vitest";
import { logEvent } from "./log-event";

/**
 * Unit tests for the Phase 40 structured activity logger (AR-01).
 *
 * logEvent writes exactly one JSON line to stdout via console.log(JSON.stringify(...)).
 * Each test captures the console.log argument and parses it back to assert the LOCKED
 * field contract shared with the CloudWatch metric filters ({ evt, userId, email, ip, ua, meta }).
 */

function capture(fn: () => void): string[] {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    fn();
    return spy.mock.calls.map((c) => String(c[0]));
  } finally {
    spy.mockRestore();
  }
}

describe("logEvent", () => {
  it("extracts ip as the first x-forwarded-for hop (Headers)", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    const [line] = capture(() => logEvent("t.event", { headers }));
    const parsed = JSON.parse(line);
    expect(parsed.ip).toBe("1.2.3.4");
  });

  it("emits valid JSON that parses back to the exact field values", () => {
    const headers = new Headers({
      "x-forwarded-for": "9.9.9.9",
      "user-agent": "UnitAgent/1.0",
    });
    const [line] = capture(() =>
      logEvent("t.event", {
        headers,
        userId: "user-123",
        email: "runner@example.com",
        meta: { foo: "bar", n: 7 },
      })
    );
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      evt: "t.event",
      userId: "user-123",
      email: "runner@example.com",
      ip: "9.9.9.9",
      ua: "UnitAgent/1.0",
      meta: { foo: "bar", n: 7 },
    });
  });

  it("emits a single line with no embedded newlines", () => {
    const [line] = capture(() =>
      logEvent("t.event", { userId: "u", meta: { a: 1 } })
    );
    expect(line.includes("\n")).toBe(false);
  });

  it("supports a plain header record with case-insensitive lookup", () => {
    const [line] = capture(() =>
      logEvent("t.event", {
        headers: {
          "X-Forwarded-For": "5.6.7.8, 1.1.1.1",
          "User-Agent": "RecAgent",
        },
      })
    );
    const parsed = JSON.parse(line);
    expect(parsed.ip).toBe("5.6.7.8");
    expect(parsed.ua).toBe("RecAgent");
  });

  it("emits a line and does not throw when headers/fields are undefined", () => {
    let lines: string[] = [];
    expect(() => {
      lines = capture(() => logEvent("t.event"));
    }).not.toThrow();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.evt).toBe("t.event");
    expect(parsed.ip).toBeUndefined();
    expect(parsed.ua).toBeUndefined();
  });

  it("swallows and does not throw when JSON.stringify fails (circular meta)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    let lines: string[] = [];
    expect(() => {
      lines = capture(() => logEvent("t.event", { meta: circular }));
    }).not.toThrow();
    expect(lines).toHaveLength(0);
  });
});
