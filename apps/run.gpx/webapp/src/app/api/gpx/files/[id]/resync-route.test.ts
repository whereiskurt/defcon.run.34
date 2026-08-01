import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  fileGet: vi.fn(),
  routeGet: vi.fn(),
  routeSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  s3Send: vi.fn(async () => ({})),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({
  assertNotLockedLive: mocks.assertNotLockedLive,
}));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: { get: (k: unknown) => ({ go: () => mocks.fileGet(k) }) },
}));
vi.mock("@/entities/route", () => ({
  Route: {
    get: (k: unknown) => ({ go: () => mocks.routeGet(k) }),
    update: () => ({ set: mocks.routeSet }),
  },
}));

import { POST } from "./resync-route/route";

const OWNER = "owner-sub-1";
const ctx = { params: Promise.resolve({ id: "f1" }) };
const req = () =>
  new Request("http://localhost/api/gpx/files/f1/resync-route", {
    method: "POST",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: OWNER, services: ["gpxstudio"] } });
  mocks.assertNotLockedLive.mockResolvedValue(false);
});

describe("POST /api/gpx/files/[id]/resync-route", () => {
  it("no-ops cheaply when the route is not published", async () => {
    mocks.fileGet.mockResolvedValue({
      data: { userId: OWNER, fileId: "f1", status: "active" },
    });

    const body = await (await POST(req(), ctx)).json();

    expect(body.synced).toBe(false);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("copies content and refreshes metrics for a published route", async () => {
    mocks.fileGet.mockResolvedValue({
      data: {
        userId: OWNER,
        fileId: "f1",
        status: "active",
        publishedRouteId: "r1",
        bucket: "test-bucket",
        key: `uploads/${OWNER}/f1.gpx`,
        fileSize: 999,
        trackCount: 2,
        totalDistance: 5000,
      },
    });
    mocks.routeGet.mockResolvedValue({
      data: { routeId: "r1", ownerId: OWNER, key: "uploads/ROUTES/r1.gpx" },
    });

    const body = await (await POST(req(), ctx)).json();

    expect(body.synced).toBe(true);
    expect(mocks.s3Send).toHaveBeenCalledTimes(1);
    expect(mocks.routeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        fileSize: 999,
        trackCount: 2,
        totalDistance: 5000,
      })
    );
  });

  it("does not touch a Route owned by someone else", async () => {
    mocks.fileGet.mockResolvedValue({
      data: {
        userId: OWNER,
        fileId: "f1",
        status: "active",
        publishedRouteId: "r1",
      },
    });
    mocks.routeGet.mockResolvedValue({
      data: { routeId: "r1", ownerId: "somebody-else" },
    });

    const body = await (await POST(req(), ctx)).json();

    expect(body.synced).toBe(false);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("no-ops when the linked Route has vanished", async () => {
    mocks.fileGet.mockResolvedValue({
      data: {
        userId: OWNER,
        fileId: "f1",
        status: "active",
        publishedRouteId: "r-gone",
      },
    });
    mocks.routeGet.mockResolvedValue({ data: null });

    const body = await (await POST(req(), ctx)).json();

    expect(body.synced).toBe(false);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(req(), ctx)).status).toBe(401);
  });

  it("403s a locked-out identity", async () => {
    mocks.assertNotLockedLive.mockResolvedValue(true);
    expect((await POST(req(), ctx)).status).toBe(403);
  });
});
