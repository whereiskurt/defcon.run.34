import { describe, it, expect, vi } from "vitest";

// Mocked out so the default-deps path (exercised only by reconcileBestEffort's
// tests below) never hits real DynamoDB/S3 — every reconcileAccomplishments
// test in this file passes explicit listFiles/loadGpx deps instead.
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    query: {
      primary: () => {
        throw new Error("gpx-reconcile.test: default listFiles must not be reached");
      },
    },
  },
}));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: vi.fn() },
  BUCKET: "test-bucket",
}));

import {
  conDayCompletedAt,
  reconcileAccomplishments,
  reconcileBestEffort,
  type GpxFileRow,
} from "./gpx-reconcile";

// A tiny valid track so parseTrack has something to chew on.
const SAMPLE_GPX = `<?xml version="1.0"?>
<gpx>
  <trk><trkseg>
    <trkpt lat="36.1699" lon="-115.1398"><ele>600</ele></trkpt>
    <trkpt lat="36.1710" lon="-115.1398"><ele>610</ele></trkpt>
    <trkpt lat="36.1720" lon="-115.1398"><ele>605</ele></trkpt>
  </trkseg></trk>
</gpx>`;

const FILES: GpxFileRow[] = [
  {
    userId: "sub-1",
    fileId: "f1",
    fileName: "Run 1.gpx",
    bucket: "b",
    key: "k1",
    status: "active",
    conDay: "2026-08-07",
    source: "upload",
  },
  {
    userId: "sub-1",
    fileId: "f2",
    fileName: "Run 2.gpx",
    bucket: "b",
    key: "k2",
    status: "active",
    conDay: "2026-08-07",
    source: "strava",
    stravaActivityId: "9",
  },
  {
    // active but NOT con-day tagged — excluded from the runs list entirely.
    userId: "sub-1",
    fileId: "f3",
    fileName: "Run 3.gpx",
    bucket: "b",
    key: "k3",
    status: "active",
  },
  {
    // con-day tagged but still pending — excluded.
    userId: "sub-1",
    fileId: "f4",
    fileName: "Run 4.gpx",
    bucket: "b",
    key: "k4",
    status: "pending",
    conDay: "2026-08-07",
  },
];

type FetchCall = { url: string; init: RequestInit };

function makeFetch(putResponse: { status: number; body?: unknown }) {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init.method === "PUT") {
      return new Response(JSON.stringify(putResponse.body ?? {}), {
        status: putResponse.status,
      });
    }
    // POST to /api/internal/accomplishment
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("conDayCompletedAt", () => {
  it("parses a con-day date as noon Pacific", () => {
    expect(conDayCompletedAt("2026-08-07")).toBe(
      Date.parse("2026-08-07T12:00:00-07:00")
    );
  });
});

describe("reconcileAccomplishments", () => {
  it("PUTs only active+conDay run summaries, then POSTs each missing one with source/stravaActivityId/decimated polyline", async () => {
    const { fetchImpl, calls } = makeFetch({
      status: 200,
      body: { ok: true, deleted: 1, missing: ["f2"] },
    });
    const loadGpx = vi.fn(async () => SAMPLE_GPX);
    const listFiles = vi.fn(async () => FILES);

    const result = await reconcileAccomplishments("sub-1", {
      fetchImpl,
      listFiles,
      loadGpx,
    });

    expect(result).toEqual({ deleted: 1, created: 1 });

    // Exactly one PUT, body runs = ONLY f1 + f2 summaries.
    const putCalls = calls.filter((c) => c.init.method === "PUT");
    expect(putCalls).toHaveLength(1);
    const putBody = JSON.parse(putCalls[0].init.body as string);
    expect(putBody.oidcSub).toBe("sub-1");
    expect(putBody.runs).toEqual([
      { gpxFileId: "f1", source: "gpx" },
      { gpxFileId: "f2", source: "strava", stravaActivityId: "9" },
    ]);

    // Exactly one loadGpx, for f2 only.
    expect(loadGpx).toHaveBeenCalledTimes(1);
    expect(loadGpx).toHaveBeenCalledWith("b", "k2");

    // Exactly one POST, for f2, carrying source/stravaActivityId/completedAt/polyline.
    const postCalls = calls.filter((c) => c.init.method === "POST");
    expect(postCalls).toHaveLength(1);
    const postBody = JSON.parse(postCalls[0].init.body as string);
    expect(postBody.gpxFileId).toBe("f2");
    expect(postBody.source).toBe("strava");
    expect(postBody.stravaActivityId).toBe("9");
    expect(postBody.completedAt).toBe(conDayCompletedAt("2026-08-07"));
    expect(Array.isArray(postBody.polyline)).toBe(true);
    expect(postBody.polyline.length).toBeGreaterThan(0);
    expect(postBody.polyline[0]).toEqual({ lat: 36.1699, lng: -115.1398 });
  });

  it("does zero loadGpx/POST calls when missing is empty", async () => {
    const { fetchImpl, calls } = makeFetch({
      status: 200,
      body: { ok: true, deleted: 0, missing: [] },
    });
    const loadGpx = vi.fn(async () => SAMPLE_GPX);

    const result = await reconcileAccomplishments("sub-1", {
      fetchImpl,
      listFiles: async () => FILES,
      loadGpx,
    });

    expect(result).toEqual({ deleted: 0, created: 0 });
    expect(loadGpx).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(0);
  });

  it("returns {deleted:0,created:0} without throwing when the PUT is non-2xx", async () => {
    const { fetchImpl } = makeFetch({ status: 500 });
    const loadGpx = vi.fn();

    await expect(
      reconcileAccomplishments("sub-1", {
        fetchImpl,
        listFiles: async () => FILES,
        loadGpx,
      })
    ).resolves.toEqual({ deleted: 0, created: 0 });
    expect(loadGpx).not.toHaveBeenCalled();
  });

  it("skips (does not count) a missing id whose gpx text fails to load", async () => {
    const { fetchImpl } = makeFetch({
      status: 200,
      body: { ok: true, deleted: 0, missing: ["f2"] },
    });
    const loadGpx = vi.fn(async () => {
      throw new Error("s3 down");
    });

    const result = await reconcileAccomplishments("sub-1", {
      fetchImpl,
      listFiles: async () => FILES,
      loadGpx,
    });

    expect(result).toEqual({ deleted: 0, created: 0 });
  });
});

describe("reconcileBestEffort", () => {
  it("never throws synchronously and never produces an unhandled rejection, even when reconcile fails outright", async () => {
    expect(() => reconcileBestEffort("sub-1")).not.toThrow();
    // Let the swallowed rejection's microtask settle before the test ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
