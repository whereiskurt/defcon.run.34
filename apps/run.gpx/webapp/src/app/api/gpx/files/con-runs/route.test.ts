import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  getSignedUrl: vi.fn(async () => "https://s3/presigned"),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: { query: { byCreatedAt: () => ({ go: mocks.query }) } },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.getSignedUrl }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1", services: ["gpxstudio"] } });
  mocks.query.mockResolvedValue({
    data: [
      { fileId: "a", fileName: "a.gpx", conDay: "2026-08-07", status: "active", bucket: "b", key: "k/a", totalDistance: 5000, bounds: { minLat: 1, maxLat: 2, minLon: 3, maxLon: 4 } },
      { fileId: "b", fileName: "b.gpx", conDay: undefined, status: "active", bucket: "b", key: "k/b" },
      { fileId: "c", fileName: "c.gpx", conDay: "2026-08-06", status: "failed", bucket: "b", key: "k/c" },
    ],
  });
});

describe("GET /api/gpx/files/con-runs", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns only active, day-tagged files with presigned URLs", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      fileId: "a",
      conDay: "2026-08-07",
      downloadUrl: "https://s3/presigned",
      totalDistance: 5000,
    });
  });
});
