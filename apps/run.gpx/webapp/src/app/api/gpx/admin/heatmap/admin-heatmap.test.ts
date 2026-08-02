import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  fileGet: vi.fn(),
  fileSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  fileRemove: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  fileDelete: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  shareByFile: vi.fn(async () => ({ data: [] })),
  shareDelete: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  s3Send: vi.fn(async () => ({})),
  reconcileBestEffort: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({
  assertNotLockedLive: mocks.assertNotLockedLive,
}));
vi.mock("@/lib/log-event", () => ({ logEvent: mocks.logEvent }));
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
    update: () => ({ set: mocks.fileSet, remove: mocks.fileRemove }),
    delete: mocks.fileDelete,
  },
}));
vi.mock("@/entities/gpx-share", () => ({
  GpxShare: {
    query: { byFile: () => ({ go: mocks.shareByFile }) },
    delete: mocks.shareDelete,
  },
}));

import { POST, DELETE } from "./[fileId]/route";

const ADMIN = "admin-sub";
const OWNER = "owner-sub";
const ctx = { params: Promise.resolve({ fileId: "f1" }) };

const hideReq = (body: unknown) =>
  new Request("http://localhost/api/gpx/admin/heatmap/f1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const delReq = (qs = "?userId=owner-sub") =>
  new Request(`http://localhost/api/gpx/admin/heatmap/f1${qs}`, {
    method: "DELETE",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: ADMIN, services: ["gpxstudio", "admin"] },
  });
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.fileGet.mockResolvedValue({
    data: {
      userId: OWNER,
      fileId: "f1",
      fileName: "run.gpx",
      bucket: "test-bucket",
      key: `uploads/${OWNER}/f1.gpx`,
      conDay: "2026-08-07",
    },
  });
  mocks.shareByFile.mockResolvedValue({ data: [] });
});

describe("admin heat-map moderation — gates", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(hideReq({ userId: OWNER, hidden: true }), ctx)).status).toBe(401);
    expect((await DELETE(delReq(), ctx)).status).toBe(401);
  });

  it("404s a non-admin — non-disclosure, never 403", async () => {
    mocks.auth.mockResolvedValue({ user: { id: OWNER, services: ["gpxstudio"] } });
    expect((await POST(hideReq({ userId: OWNER, hidden: true }), ctx)).status).toBe(404);
    expect((await DELETE(delReq(), ctx)).status).toBe(404);
    expect(mocks.fileSet).not.toHaveBeenCalled();
    expect(mocks.fileDelete).not.toHaveBeenCalled();
  });

  it("403s a locked-out admin", async () => {
    mocks.assertNotLockedLive.mockResolvedValue(true);
    expect((await POST(hideReq({ userId: OWNER, hidden: true }), ctx)).status).toBe(403);
  });

  it("400s without userId — the pk needs the owner, not the session", async () => {
    expect((await POST(hideReq({ hidden: true }), ctx)).status).toBe(400);
    expect((await DELETE(delReq(""), ctx)).status).toBe(400);
  });

  it("404s a run that does not exist", async () => {
    mocks.fileGet.mockResolvedValue({ data: null });
    expect((await POST(hideReq({ userId: OWNER, hidden: true }), ctx)).status).toBe(404);
    expect((await DELETE(delReq(), ctx)).status).toBe(404);
  });
});

describe("hide / unhide", () => {
  it("sets heatmapHidden on the OWNER's row, not the admin's", async () => {
    const body = await (await POST(hideReq({ userId: OWNER, hidden: true }), ctx)).json();

    expect(body).toEqual({ fileId: "f1", hidden: true });
    expect(mocks.fileSet).toHaveBeenCalledWith({ heatmapHidden: true });
    expect(mocks.fileGet).toHaveBeenCalledWith({ userId: OWNER, fileId: "f1" });
  });

  it("removes the attribute on unhide so the row looks unmoderated again", async () => {
    await POST(hideReq({ userId: OWNER, hidden: false }), ctx);

    expect(mocks.fileRemove).toHaveBeenCalledWith(["heatmapHidden"]);
    expect(mocks.fileSet).not.toHaveBeenCalled();
  });

  it("does NOT rebuild the artifact — that is a separate, explicit action", async () => {
    await POST(hideReq({ userId: OWNER, hidden: true }), ctx);
    // A rebuild would have to read geometry from S3; nothing here touches it.
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("400s a non-boolean hidden", async () => {
    expect((await POST(hideReq({ userId: OWNER, hidden: "yes" }), ctx)).status).toBe(400);
  });
});

describe("delete", () => {
  it("cascades shares, S3 object and row, then reconciles the leaderboard", async () => {
    mocks.shareByFile.mockResolvedValue({ data: [{ shareId: "s1" }] });

    const body = await (await DELETE(delReq(), ctx)).json();

    expect(body.deleted).toBe(true);
    expect(mocks.shareDelete).toHaveBeenCalledTimes(1);
    expect(mocks.s3Send).toHaveBeenCalledTimes(1);
    expect(mocks.fileDelete).toHaveBeenCalledWith({ userId: OWNER, fileId: "f1" });
    // A scored con-day run just vanished — run.human must re-converge.
    expect(mocks.reconcileBestEffort).toHaveBeenCalledWith(OWNER);
  });
});
