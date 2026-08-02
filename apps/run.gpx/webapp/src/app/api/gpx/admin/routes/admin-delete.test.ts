import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  routeGet: vi.fn(),
  routeDelete: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  fileGet: vi.fn(),
  fileRemove: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  s3Send: vi.fn(async () => ({})),
  logEvent: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({
  assertNotLockedLive: mocks.assertNotLockedLive,
}));
vi.mock("@/lib/log-event", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
}));
vi.mock("@/entities/route", () => ({
  Route: {
    get: (k: unknown) => ({ go: () => mocks.routeGet(k) }),
    delete: mocks.routeDelete,
  },
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
    update: () => ({ remove: mocks.fileRemove }),
  },
}));

import { DELETE } from "./[id]/route";

const ADMIN = "admin-sub";
const OWNER = "owner-sub";
const ctx = { params: Promise.resolve({ id: "r1" }) };
const req = () =>
  new Request("http://localhost/api/gpx/admin/routes/r1", { method: "DELETE" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: ADMIN, services: ["gpxstudio", "admin"] },
  });
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.fileGet.mockResolvedValue({ data: null });
});

describe("DELETE /api/gpx/admin/routes/[id] — gates", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await DELETE(req(), ctx)).status).toBe(401);
  });

  it("404s a non-admin — non-disclosure, never 403", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: OWNER, services: ["gpxstudio"] },
    });
    const response = await DELETE(req(), ctx);
    expect(response.status).toBe(404);
    expect(mocks.routeDelete).not.toHaveBeenCalled();
  });

  it("403s a locked-out admin", async () => {
    mocks.assertNotLockedLive.mockResolvedValue(true);
    expect((await DELETE(req(), ctx)).status).toBe(403);
  });

  it("404s a route that does not exist", async () => {
    mocks.routeGet.mockResolvedValue({ data: null });
    expect((await DELETE(req(), ctx)).status).toBe(404);
  });
});

describe("DELETE /api/gpx/admin/routes/[id] — behavior", () => {
  it("deletes the Route row and its S3 object", async () => {
    mocks.routeGet.mockResolvedValue({
      data: {
        routeId: "r1",
        ownerId: OWNER,
        name: "Strip Loop",
        bucket: "test-bucket",
        key: "uploads/ROUTES/r1.gpx",
      },
    });

    const body = await (await DELETE(req(), ctx)).json();

    expect(body.deleted).toBe(true);
    expect(mocks.s3Send).toHaveBeenCalledTimes(1);
    expect(mocks.routeDelete).toHaveBeenCalledWith({ routeId: "r1" });
  });

  it("clears publishedRouteId on the backing file so the owner's row is not left dangling", async () => {
    mocks.routeGet.mockResolvedValue({
      data: {
        routeId: "r1",
        ownerId: OWNER,
        name: "Strip Loop",
        bucket: "test-bucket",
        key: "uploads/ROUTES/r1.gpx",
        sourceGpxFileId: "f1",
      },
    });
    mocks.fileGet.mockResolvedValue({
      data: { userId: OWNER, fileId: "f1", publishedRouteId: "r1" },
    });

    const body = await (await DELETE(req(), ctx)).json();

    expect(body.deleted).toBe(true);
    expect(body.hadBackingFile).toBe(true);
    expect(mocks.fileRemove).toHaveBeenCalledWith(["publishedRouteId"]);
  });

  it("reports an orphan so the UI can warn it destroys the owner's only copy", async () => {
    mocks.routeGet.mockResolvedValue({
      data: {
        routeId: "r1",
        ownerId: OWNER,
        name: "Shannon's Adventure",
        bucket: "test-bucket",
        key: "uploads/ROUTES/r1.gpx",
      },
    });

    const body = await (await DELETE(req(), ctx)).json();

    expect(body.hadBackingFile).toBe(false);
    expect(mocks.fileRemove).not.toHaveBeenCalled();
  });

  it("still deletes when the backing file is already gone", async () => {
    mocks.routeGet.mockResolvedValue({
      data: {
        routeId: "r1",
        ownerId: OWNER,
        name: "Strip Loop",
        bucket: "test-bucket",
        key: "uploads/ROUTES/r1.gpx",
        sourceGpxFileId: "f-gone",
      },
    });
    mocks.fileGet.mockResolvedValue({ data: null });

    const body = await (await DELETE(req(), ctx)).json();

    expect(body.deleted).toBe(true);
    expect(mocks.routeDelete).toHaveBeenCalled();
    expect(mocks.fileRemove).not.toHaveBeenCalled();
  });
});
