import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  fileGet: vi.fn(),
  fileDeleteGo: vi.fn(async () => ({})),
  s3Send: vi.fn(async () => ({})),
  shareQuery: vi.fn(async () => ({ data: [] })),
  reconcileBestEffort: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({ assertNotLockedLive: mocks.assertNotLockedLive }));
vi.mock("@/lib/gpx-reconcile", () => ({ reconcileBestEffort: mocks.reconcileBestEffort }));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  s3ClientForPresign: {},
  getUserPrefix: (userId: string) => `uploads/${userId}/gpx/`,
  BUCKET: "test-bucket",
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
    delete: () => ({ go: mocks.fileDeleteGo }),
  },
}));
vi.mock("@/entities/gpx-share", () => ({
  GpxShare: { query: { byFile: () => ({ go: mocks.shareQuery }) } },
}));

import { DELETE } from "./route";

const params = { params: Promise.resolve({ id: "f1" }) };

function del() {
  return new Request("http://x/api/gpx/files/f1", { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1", services: ["gpxstudio"] } });
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.shareQuery.mockResolvedValue({ data: [] });
  mocks.fileDeleteGo.mockResolvedValue({});
});

describe("DELETE /api/gpx/files/[id] reconcile trigger", () => {
  it("fires reconcileBestEffort(targetUserId) for an individually-owned file", async () => {
    mocks.fileGet.mockResolvedValue({
      data: { userId: "u1", fileId: "f1", bucket: "b", key: "k1" },
    });

    const res = await DELETE(del(), params);

    expect(res.status).toBe(200);
    expect(mocks.reconcileBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileBestEffort).toHaveBeenCalledWith("u1");
  });

  it("does NOT fire reconcileBestEffort for a GLOBAL community file", async () => {
    mocks.fileGet
      .mockResolvedValueOnce({ data: null }) // not found under the user's own id
      .mockResolvedValueOnce({
        data: { userId: "GLOBAL", fileId: "f1", bucket: "b", key: "k1", uploadedBy: "u1" },
      });

    const res = await DELETE(del(), params);

    expect(res.status).toBe(200);
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });
});
