import { describe, it, expect, vi } from "vitest";
import { StopQueryCommand } from "@aws-sdk/client-cloudwatch-logs";
import {
  isValidIp,
  isSafeUserId,
  ipsOfUserQuery,
  usersOfIpQuery,
  logGroupName,
  runInsights,
  __mapResultsForTest,
} from "./insights";

describe("isValidIp", () => {
  it("accepts IPv4 and IPv6, rejects junk / injection", () => {
    expect(isValidIp("65.25.248.28")).toBe(true);
    expect(isValidIp("2001:db8::1")).toBe(true);
    expect(isValidIp("999.1.1.1")).toBe(false);
    expect(isValidIp('1.1.1.1" or evt="x')).toBe(false);
    expect(isValidIp("")).toBe(false);
    expect(isValidIp("not-an-ip")).toBe(false);
  });
});

describe("isSafeUserId", () => {
  it("accepts id charset, rejects quotes/spaces/injection", () => {
    expect(isSafeUserId("1bd4a2f0-1234-4abc-9def-000000000000")).toBe(true);
    expect(isSafeUserId('x" or userId="y')).toBe(false);
    expect(isSafeUserId("has space")).toBe(false);
    expect(isSafeUserId("")).toBe(false);
  });
});

describe("query builders", () => {
  it("embeds the (validated) value and filters login+signup before stats", () => {
    const q = ipsOfUserQuery("USER1");
    expect(q).toContain('userId="USER1"');
    expect(q).toContain('evt="auth.login"');
    expect(q).toContain('evt="auth.signup"');
    expect(q.indexOf("filter")).toBeLessThan(q.indexOf("stats")); // filter before stats
    expect(usersOfIpQuery("1.2.3.4")).toContain('ip="1.2.3.4"');
  });
});

describe("logGroupName", () => {
  it("derives from REGION_SHORT, honors AUTH_LOG_GROUP override", () => {
    vi.stubEnv("AUTH_LOG_GROUP", "");
    vi.stubEnv("REGION_SHORT", "cac1");
    expect(logGroupName()).toBe("/ecs/run-auth-app-run-auth-cac1-dc34");
    vi.stubEnv("AUTH_LOG_GROUP", "/custom/group");
    expect(logGroupName()).toBe("/custom/group");
    vi.unstubAllEnvs();
  });
});

describe("__mapResultsForTest", () => {
  it("maps [{field,value}] rows to objects and drops @ptr", () => {
    const rows = __mapResultsForTest([
      [{ field: "ip", value: "1.2.3.4" }, { field: "logins", value: "3" }, { field: "@ptr", value: "xxx" }],
    ]);
    expect(rows).toEqual([{ ip: "1.2.3.4", logins: "3" }]);
  });
});

describe("runInsights", () => {
  function fakeClient(script: any[]) {
    const send = vi.fn();
    for (const r of script) send.mockResolvedValueOnce(r);
    return { send };
  }

  it("polls until Complete and returns mapped rows", async () => {
    const client = fakeClient([
      { queryId: "q1" }, // StartQuery
      { status: "Running", results: [] }, // GetQueryResults #1
      { status: "Complete", results: [[{ field: "ip", value: "1.2.3.4" }, { field: "logins", value: "2" }]] },
    ]);
    const out = await runInsights("q", 0, 1000, { client: client as any, pollMs: 1 });
    expect(out.partial).toBe(false);
    expect(out.rows).toEqual([{ ip: "1.2.3.4", logins: "2" }]);
    expect(client.send).toHaveBeenCalledTimes(3);
  });

  it("returns partial=true and stops the query on timeout", async () => {
    const client = fakeClient([
      { queryId: "q1" },
      { status: "Running", results: [] },
      { status: "Running", results: [] },
      {}, // StopQuery response
    ]);
    const out = await runInsights("q", 0, 1000, { client: client as any, pollMs: 1, timeoutMs: 5 });
    expect(out.partial).toBe(true);
    expect(out.rows).toEqual([]);
    expect(client.send).toHaveBeenLastCalledWith(expect.any(StopQueryCommand));
  });

  it("returns empty when StartQuery yields no queryId", async () => {
    const client = fakeClient([{}]);
    const out = await runInsights("q", 0, 1000, { client: client as any });
    expect(out.rows).toEqual([]);
    expect(out.partial).toBe(false);
  });

  it("degrades to partial=true (no throw) when GetQueryResults rejects, and best-effort stops the query", async () => {
    const send = vi.fn();
    send.mockResolvedValueOnce({ queryId: "q1" }); // StartQuery
    send.mockRejectedValueOnce(new Error("throttled")); // GetQueryResults throws
    send.mockResolvedValueOnce({}); // StopQuery
    const client = { send };

    const out = await runInsights("q", 0, 1000, { client: client as any, pollMs: 1 });
    expect(out).toEqual({ rows: [], partial: true });
    expect(client.send).toHaveBeenLastCalledWith(expect.any(StopQueryCommand));
  });

  it("degrades to partial=true (no throw) when StartQuery itself rejects", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("network error"));
    const client = { send };

    const out = await runInsights("q", 0, 1000, { client: client as any, pollMs: 1 });
    expect(out).toEqual({ rows: [], partial: true });
  });
});
