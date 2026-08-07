import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The truncation guard on `summarizeUploadedGpx`.
 *
 * A ranged GET that clips the tail still yields a plausible-looking distance,
 * and uploads are permitted up to 20 MB (100 MB for admins) against a smaller
 * read cap — so this is reachable, not theoretical. Returning null keeps a gap
 * visible instead of turning it into a confident wrong number.
 */

const mocks = vi.hoisted(() => ({ s3Send: vi.fn() }));

vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
}));
vi.mock("../s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
}));

import {
  contentRangeTotal,
  summarizeUploadedGpx,
  UPLOAD_SUMMARY_MAX_BYTES,
} from "../route-summary";

const GPX = `<gpx><trk><trkseg>
  <trkpt lat="36.1000" lon="-115.1500"><ele>610</ele></trkpt>
  <trkpt lat="36.1100" lon="-115.1500"><ele>615</ele></trkpt>
</trkseg></trk></gpx>`;

/** An S3 ranged-GET response. `total` omitted ⇒ no Content-Range header. */
const s3Response = (text: string, total?: number) => ({
  ...(total === undefined
    ? {}
    : { ContentRange: `bytes 0-${Math.min(total, UPLOAD_SUMMARY_MAX_BYTES)}/${total}` }),
  Body: { transformToString: async () => text },
});

beforeEach(() => vi.clearAllMocks());

describe("contentRangeTotal", () => {
  it("pulls the total out of a well-formed header", () => {
    expect(contentRangeTotal("bytes 0-1023/4096")).toBe(4096);
  });

  it("returns null for the unknown-length form and for junk", () => {
    expect(contentRangeTotal("bytes 0-1023/*")).toBeNull();
    expect(contentRangeTotal("nonsense")).toBeNull();
    expect(contentRangeTotal(undefined)).toBeNull();
  });
});

describe("summarizeUploadedGpx", () => {
  it("summarizes an ordinary file", async () => {
    mocks.s3Send.mockResolvedValue(s3Response(GPX, GPX.length));

    const summary = await summarizeUploadedGpx("k");

    expect(summary).not.toBeNull();
    expect(summary!.trackCount).toBe(1);
    expect(summary!.totalDistance).toBeGreaterThan(0);
    expect(summary!.bounds).toBeDefined();
  });

  it("returns NULL when the object is larger than the read cap", async () => {
    // The body we got back is a valid prefix — it would summarize just fine,
    // which is exactly the trap.
    mocks.s3Send.mockResolvedValue(s3Response(GPX, UPLOAD_SUMMARY_MAX_BYTES + 1));

    expect(await summarizeUploadedGpx("k")).toBeNull();
  });

  it("accepts an object exactly at the cap", async () => {
    mocks.s3Send.mockResolvedValue(s3Response(GPX, UPLOAD_SUMMARY_MAX_BYTES));

    expect(await summarizeUploadedGpx("k")).not.toBeNull();
  });

  it("falls back to body length when S3 sends no Content-Range", async () => {
    const big = "x".repeat(64);
    mocks.s3Send.mockResolvedValue(s3Response(big));

    // Under a tiny cap the same body is over the ceiling — still null.
    expect(await summarizeUploadedGpx("k", 8)).toBeNull();
    expect(await summarizeUploadedGpx("k", 4096)).not.toBeNull();
  });

  it("requests one byte PAST the cap so an exact-size file is read whole", async () => {
    mocks.s3Send.mockResolvedValue(s3Response(GPX, GPX.length));

    await summarizeUploadedGpx("k", 1000);

    expect(mocks.s3Send.mock.calls[0][0].input.Range).toBe("bytes=0-1000");
  });

  it("returns a zero-distance summary with NO bounds for a trackless file", async () => {
    const trackless = `<gpx><trk><trkseg></trkseg></trk></gpx>`;
    mocks.s3Send.mockResolvedValue(s3Response(trackless, trackless.length));

    const summary = await summarizeUploadedGpx("k");

    expect(summary!.totalDistance).toBe(0);
    // A degenerate box would spread Math.min over an empty array; map consumers
    // would then try to fit to {minLat: Infinity, ...}.
    expect(summary!.bounds).toBeUndefined();
  });
});
