import { describe, it, expect } from "vitest";
import { handler } from "../index.mjs";

const row = (obj, ts) => [
  { field: "@timestamp", value: ts },
  { field: "@message", value: JSON.stringify(obj) },
];

function makeDeps({ watermark = 0, rows = { results: [] } } = {}) {
  const state = { stats: [], written: null, queried: null };
  const deps = {
    now: () => 2_000_000,
    readWatermark: async () => watermark,
    runQuery: async (args) => {
      state.queried = args;
      return rows;
    },
    writeStat: async (s) => {
      state.stats.push(s);
    },
    writeWatermark: async (w) => {
      state.written = w;
    },
  };
  return { deps, state };
}

describe("rollup handler", () => {
  it("cron path (no headers) aggregates, writes stat rows, advances watermark", async () => {
    const rows = {
      results: [
        row({ type: "redirect", code: "BUNNY", param: "42" }, "1000000"),
        row({ type: "redirect", code: "BUNNY", param: null }, "1500000"),
      ],
    };
    const { deps, state } = makeDeps({ watermark: 0, rows });

    const res = await handler({}, deps);

    expect(res.ok).toBe(true);
    expect(res.processed).toBe(2);
    expect(res.watermark).toBe(1500000);
    expect(state.written).toBe(1500000);

    const total = state.stats.find((s) => s.code === "BUNNY" && s.bucket === "total");
    expect(total.countDelta).toBe(2);
    expect(state.stats.find((s) => s.bucket === "param#42").countDelta).toBe(1);
  });

  it("passes the watermark window to runQuery as epoch seconds", async () => {
    const { deps, state } = makeDeps({ watermark: 1_000_000 });
    await handler({}, deps);
    expect(state.queried.startTime).toBe(1000); // 1_000_000ms -> 1000s
    expect(state.queried.endTime).toBe(2000); // now() 2_000_000ms -> 2000s
    expect(typeof state.queried.query).toBe("string");
  });

  it("keeps the prior watermark when nothing matched", async () => {
    const { deps, state } = makeDeps({ watermark: 777, rows: { results: [] } });
    const res = await handler({}, deps);
    expect(res.processed).toBe(0);
    expect(res.watermark).toBe(777);
    expect(state.written).toBe(777);
    expect(state.stats).toEqual([]);
  });

  it("allows a flush with the correct token", async () => {
    process.env.QR_FLUSH_TOKEN = "secret";
    const { deps } = makeDeps({ rows: { results: [] } });
    const res = await handler({ headers: { "x-qr-flush-token": "secret" } }, deps);
    expect(res.ok).toBe(true);
  });

  it("forbids a flush with the wrong token", async () => {
    process.env.QR_FLUSH_TOKEN = "secret";
    const { deps, state } = makeDeps({ rows: { results: [] } });
    const res = await handler({ headers: { "x-qr-flush-token": "nope" } }, deps);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("forbidden");
    expect(state.written).toBe(null); // guard short-circuits before any work
  });
});
