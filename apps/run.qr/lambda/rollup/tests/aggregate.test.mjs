import { describe, it, expect } from "vitest";
import { aggregate, nextWatermark } from "../lib/aggregate.mjs";

const ts = (iso) => Date.parse(iso);
const byKey = (out) => Object.fromEntries(out.map((s) => [`${s.code}|${s.bucket}`, s]));

describe("aggregate", () => {
  it("redirect line increments total, day, and param buckets for the code", () => {
    const out = aggregate([
      { type: "redirect", code: "BUNNY", param: "42", _ts: ts("2026-07-12T10:00:00Z") },
    ]);
    const k = byKey(out);
    expect(k["BUNNY|total"].countDelta).toBe(1);
    expect(k["BUNNY|day#2026-07-12"].countDelta).toBe(1);
    expect(k["BUNNY|param#42"].countDelta).toBe(1);
  });

  it("omits the param bucket when param is null", () => {
    const out = aggregate([{ type: "redirect", code: "X", param: null, _ts: ts("2026-07-12T00:00:00Z") }]);
    expect(out.find((s) => s.bucket.startsWith("param#"))).toBeUndefined();
    expect(byKey(out)["X|total"].countDelta).toBe(1);
  });

  it("ctf-handoff increments ctf#<challenge> total + day buckets", () => {
    const out = aggregate([
      { type: "ctf-handoff", challenge: "sql1", region: "use1", result: "handoff", _ts: ts("2026-07-12T05:00:00Z") },
    ]);
    const k = byKey(out);
    expect(k["ctf#sql1|total"].countDelta).toBe(1);
    expect(k["ctf#sql1|day#2026-07-12"].countDelta).toBe(1);
  });

  it("collapses repeated keys, summing deltas and keeping the max lastSeen", () => {
    const out = aggregate([
      { type: "redirect", code: "BUNNY", param: null, _ts: ts("2026-07-12T10:00:00Z") },
      { type: "redirect", code: "BUNNY", param: null, _ts: ts("2026-07-12T12:00:00Z") },
    ]);
    const total = byKey(out)["BUNNY|total"];
    expect(total.countDelta).toBe(2);
    expect(total.lastSeen).toBe(new Date(ts("2026-07-12T12:00:00Z")).toISOString());
  });

  it("buckets by UTC day boundary", () => {
    const out = aggregate([
      { type: "redirect", code: "Z", param: null, _ts: ts("2026-07-12T23:59:59Z") },
      { type: "redirect", code: "Z", param: null, _ts: ts("2026-07-13T00:00:01Z") },
    ]);
    const k = byKey(out);
    expect(k["Z|day#2026-07-12"].countDelta).toBe(1);
    expect(k["Z|day#2026-07-13"].countDelta).toBe(1);
    expect(k["Z|total"].countDelta).toBe(2);
  });

  it("ignores unknown line types", () => {
    expect(aggregate([{ type: "mystery", _ts: ts("2026-07-12T00:00:00Z") }])).toEqual([]);
  });
});

describe("nextWatermark", () => {
  it("returns the max _ts across the batch", () => {
    expect(nextWatermark([{ _ts: 5 }, { _ts: 9 }, { _ts: 3 }], 0)).toBe(9);
  });

  it("returns the previous watermark when the batch is empty", () => {
    expect(nextWatermark([], 123)).toBe(123);
  });
});
