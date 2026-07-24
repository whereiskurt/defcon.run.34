import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  validateGpxFile: vi.fn(async (): Promise<{ valid: boolean; error?: string }> => ({
    valid: true,
  })),
  s3Send: vi.fn(async () => ({})),
  fileGet: vi.fn(),
  fileUpdateSet: vi.fn(() => ({
    go: vi.fn(async () => ({ data: { userId: "u1", fileId: "f1", status: "active" } })),
  })),
  reconcileBestEffort: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({ assertNotLockedLive: mocks.assertNotLockedLive }));
vi.mock("@/lib/gpx-validator", () => ({ validateGpxFile: mocks.validateGpxFile }));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
}));
vi.mock("@/lib/gpx-reconcile", () => ({ reconcileBestEffort: mocks.reconcileBestEffort }));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
    update: () => ({ set: mocks.fileUpdateSet }),
  },
}));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "f1" }) };

function post() {
  return new Request("http://x/api/gpx/files/f1/confirm", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1", services: ["gpxstudio"] } });
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.validateGpxFile.mockResolvedValue({ valid: true });
  mocks.fileUpdateSet.mockReturnValue({
    go: vi.fn(async () => ({ data: { userId: "u1", fileId: "f1", status: "active" } })),
  });
});

describe("POST /api/gpx/files/[id]/confirm reconcile trigger", () => {
  it("fires reconcileBestEffort(file.data.userId) for an individually-owned file", async () => {
    mocks.fileGet.mockResolvedValue({
      data: { userId: "u1", fileId: "f1", key: "k1", fileName: "a.gpx", status: "pending" },
    });

    const res = await POST(post(), params);

    expect(res.status).toBe(200);
    expect(mocks.reconcileBestEffort).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileBestEffort).toHaveBeenCalledWith("u1");
  });

  it("does NOT fire reconcileBestEffort for a GLOBAL community file", async () => {
    // Not found under the user's own id -> falls through to the GLOBAL lookup.
    mocks.fileGet
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({
        data: {
          userId: "GLOBAL",
          fileId: "f1",
          key: "k1",
          fileName: "a.gpx",
          status: "pending",
          uploadedBy: "u1",
        },
      });

    const res = await POST(post(), params);

    expect(res.status).toBe(200);
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });

  it("does NOT fire reconcileBestEffort when GPX validation fails", async () => {
    mocks.fileGet.mockResolvedValue({
      data: { userId: "u1", fileId: "f1", key: "k1", fileName: "a.gpx", status: "pending" },
    });
    mocks.validateGpxFile.mockResolvedValue({ valid: false, error: "bad gpx" });

    const res = await POST(post(), params);

    expect(res.status).toBe(400);
    expect(mocks.reconcileBestEffort).not.toHaveBeenCalled();
  });
});
