import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  consumeQuota: vi.fn(async () => ({ success: true, remaining: 9 })),
  restoreQuota: vi.fn(async () => ({})),
  countConDayRuns: vi.fn(async () => 0),
  fileGet: vi.fn(),
  fileUpdateSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  fileUpdateRemove: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/live-lockout", () => ({ assertNotLockedLive: mocks.assertNotLockedLive }));
vi.mock("@/lib/quota-client", () => ({
  consumeQuota: mocks.consumeQuota,
  restoreQuota: mocks.restoreQuota,
}));
vi.mock("@/lib/con-day-usage", () => ({ countConDayRuns: mocks.countConDayRuns }));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
    update: () => ({ set: mocks.fileUpdateSet, remove: mocks.fileUpdateRemove }),
  },
}));
vi.mock("@/entities/gpx-share", () => ({ GpxShare: {} }));

import { PUT } from "./route";

const session = { user: { id: "u1", services: ["gpxstudio"] } };
const params = { params: Promise.resolve({ id: "f1" }) };

function put(body: unknown) {
  return new Request("http://x/api/gpx/files/f1", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(session);
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.countConDayRuns.mockResolvedValue(0);
  mocks.fileGet.mockResolvedValue({
    data: { userId: "u1", fileId: "f1", fileName: "a.gpx", conDay: "2026-08-06" },
  });
});

describe("PUT /api/gpx/files/[id] conDay", () => {
  it("moves a file to another con day when the target has budget", async () => {
    const res = await PUT(put({ conDay: "2026-08-07" }), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.conDayRemaining).toBe(9);
    expect(mocks.countConDayRuns).toHaveBeenCalledWith("u1", "2026-08-07");
    expect(mocks.fileUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ conDay: "2026-08-07" })
    );
  });

  it("accepts a future con day (no selectable gate)", async () => {
    expect((await PUT(put({ conDay: "2026-08-10" }), params)).status).toBe(200);
  });

  it("429s when the target day is capped", async () => {
    mocks.countConDayRuns.mockResolvedValue(10);
    expect((await PUT(put({ conDay: "2026-08-07" }), params)).status).toBe(429);
  });

  it("skips the cap check when re-saving the same day", async () => {
    mocks.countConDayRuns.mockResolvedValue(10);
    expect((await PUT(put({ conDay: "2026-08-06" }), params)).status).toBe(200);
    expect(mocks.countConDayRuns).not.toHaveBeenCalled();
  });

  it("clears the tag with null", async () => {
    expect((await PUT(put({ conDay: null }), params)).status).toBe(200);
    expect(mocks.fileUpdateRemove).toHaveBeenCalledWith(["conDay"]);
  });

  it("400s a non-con-day for non-admins", async () => {
    expect((await PUT(put({ conDay: "2026-09-01" }), params)).status).toBe(400);
  });
});
