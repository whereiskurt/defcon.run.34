import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Confirm must derive geometry from the uploaded bytes rather than trusting
 * whatever the client posted at create time.
 *
 * The bug this pins: `POST /api/gpx/files` stored `totalDistance: totalDistance
 * || 0` straight off the request body, the studio never sent one, and confirm
 * only ever set `status: "active"` — so 10 of 71 con-day runs carried a stored
 * distance of 0 while their real geometry sat in S3 the whole time.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  fileGet: vi.fn(),
  // Typed param: without it vi.fn() infers `never[]` args and every
  // `mock.calls[0][0]` assertion below fails to typecheck.
  updateSet: vi.fn((_attrs: Record<string, unknown>) => ({
    go: vi.fn(async () => ({ data: {} })),
  })),
  validateGpxFile: vi.fn(),
  summarizeUploadedGpx: vi.fn(),
  reconcileBestEffort: vi.fn(),
  s3Send: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({
  assertNotLockedLive: mocks.assertNotLockedLive,
}));
vi.mock("@/lib/gpx-validator", () => ({ validateGpxFile: mocks.validateGpxFile }));
vi.mock("@/lib/route-summary", () => ({
  summarizeUploadedGpx: mocks.summarizeUploadedGpx,
}));
vi.mock("@/lib/gpx-reconcile", () => ({
  reconcileBestEffort: mocks.reconcileBestEffort,
}));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
    update: () => ({ set: mocks.updateSet }),
  },
}));

import { POST } from "./route";

const OWNER = "owner-sub";
const ctx = { params: Promise.resolve({ id: "f1" }) };
const req = () =>
  new Request("http://localhost/api/gpx/files/f1/confirm", { method: "POST" });

const SUMMARY = {
  trackCount: 1,
  waypointCount: 2,
  totalDistance: 4312.7,
  totalElevation: 38,
  bounds: { minLat: 36.1, maxLat: 36.13, minLon: -115.18, maxLon: -115.15 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: OWNER, services: ["gpxstudio"] },
  });
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.fileGet.mockResolvedValue({
    data: {
      userId: OWNER,
      fileId: "f1",
      fileName: "Morning_Run.gpx",
      key: `uploads/${OWNER}/f1.gpx`,
      status: "pending",
      totalDistance: 0,
    },
  });
  mocks.validateGpxFile.mockResolvedValue({ valid: true });
  mocks.summarizeUploadedGpx.mockResolvedValue(SUMMARY);
});

describe("confirm — derived geometry", () => {
  it("writes the DERIVED distance, elevation, counts and bounds", async () => {
    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith({
      status: "active",
      trackCount: 1,
      waypointCount: 2,
      totalDistance: 4312.7,
      totalElevation: 38,
      bounds: SUMMARY.bounds,
    });
  });

  it("summarizes the row's OWN key", async () => {
    await POST(req(), ctx);
    expect(mocks.summarizeUploadedGpx).toHaveBeenCalledWith(`uploads/${OWNER}/f1.gpx`);
  });

  it("omits bounds for a trackless file rather than writing a degenerate box", async () => {
    mocks.summarizeUploadedGpx.mockResolvedValue({
      ...SUMMARY,
      totalDistance: 0,
      bounds: undefined,
    });

    await POST(req(), ctx);

    expect(mocks.updateSet.mock.calls[0][0]).not.toHaveProperty("bounds");
  });

  it("still activates, leaving stored values ALONE, when the file is too large to summarize", async () => {
    mocks.summarizeUploadedGpx.mockResolvedValue(null);

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    // Not zeroed, not guessed — untouched.
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "active" });
  });

  it("still activates when the summary THROWS — a valid upload must not fail here", async () => {
    mocks.summarizeUploadedGpx.mockRejectedValue(new Error("s3 down"));

    const res = await POST(req(), ctx);

    expect(res.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "active" });
  });

  it("never writes a source attribute", async () => {
    await POST(req(), ctx);
    expect(mocks.updateSet.mock.calls[0][0]).not.toHaveProperty("source");
  });

  it("does not summarize a file that fails validation", async () => {
    mocks.validateGpxFile.mockResolvedValue({ valid: false, error: "not gpx" });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(400);
    expect(mocks.summarizeUploadedGpx).not.toHaveBeenCalled();
  });
});
