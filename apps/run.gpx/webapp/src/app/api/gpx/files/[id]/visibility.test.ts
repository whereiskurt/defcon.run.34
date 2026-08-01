import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertNotLockedLive: vi.fn(async () => false),
  fileGet: vi.fn(),
  fileSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  fileRemove: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  routeGet: vi.fn(),
  routeCreate: vi.fn(() => ({ go: vi.fn(async () => ({ data: {} })) })),
  routeSet: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  routeRemove: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
  routeByOwner: vi.fn(async () => ({ data: [] })),
  shareByFile: vi.fn(async () => ({ data: [] })),
  shareCreate: vi.fn(() => ({ go: vi.fn(async () => ({ data: {} })) })),
  shareDelete: vi.fn(() => ({ go: vi.fn(async () => ({})) })),
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
  getRouteKey: (id: string) => `uploads/ROUTES/${id}.gpx`,
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
    update: () => ({ set: mocks.fileSet, remove: mocks.fileRemove }),
  },
}));
vi.mock("@/entities/route", () => ({
  Route: {
    get: (k: unknown) => ({ go: () => mocks.routeGet(k) }),
    create: mocks.routeCreate,
    update: () => ({ set: mocks.routeSet, remove: mocks.routeRemove }),
    query: { byOwner: () => ({ go: mocks.routeByOwner }) },
  },
}));
vi.mock("@/entities/gpx-share", () => ({
  GpxShare: {
    query: { byFile: () => ({ go: mocks.shareByFile }) },
    create: mocks.shareCreate,
    delete: mocks.shareDelete,
  },
}));

import { PUT } from "./visibility/route";

const OWNER = "owner-sub-1";

function req(body: unknown) {
  return new Request("http://localhost/api/gpx/files/f1/visibility", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "f1" }) };

function activeFile(extra: Record<string, unknown> = {}) {
  return {
    data: {
      userId: OWNER,
      fileId: "f1",
      fileName: "strip-loop.gpx",
      bucket: "test-bucket",
      key: `uploads/${OWNER}/f1.gpx`,
      fileSize: 1234,
      status: "active",
      version: 1,
      ...extra,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: OWNER, name: "Runner", services: ["gpxstudio"] },
  });
  mocks.assertNotLockedLive.mockResolvedValue(false);
  mocks.fileGet.mockResolvedValue(activeFile());
  mocks.routeGet.mockResolvedValue({ data: null });
  mocks.routeByOwner.mockResolvedValue({ data: [] });
  mocks.shareByFile.mockResolvedValue({ data: [] });
});

describe("PUT /api/gpx/files/[id]/visibility — gates", () => {
  it("401s with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(401);
  });

  it("403s without the gpxstudio service", async () => {
    mocks.auth.mockResolvedValue({ user: { id: OWNER, services: [] } });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(403);
  });

  it("403s a locked-out identity", async () => {
    mocks.assertNotLockedLive.mockResolvedValue(true);
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(403);
  });

  it("400s an unknown state", async () => {
    expect((await PUT(req({ state: "published" }), ctx)).status).toBe(400);
  });

  it("404s a file the caller does not own", async () => {
    mocks.fileGet.mockResolvedValue({ data: null });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(404);
  });
});

describe("private -> public", () => {
  it("mints a Route, publishes it, and persists publishedRouteId", async () => {
    const response = await PUT(req({ state: "public" }), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.state).toBe("public");
    expect(body.routeId).toEqual(expect.any(String));

    // S3 object copied to the sentinel ROUTES key — never a user-identified path.
    expect(mocks.s3Send).toHaveBeenCalledTimes(1);
    const created = mocks.routeCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.key).toBe(`uploads/ROUTES/${body.routeId}.gpx`);
    expect(created.ownerId).toBe(OWNER);
    expect(created.visibility).toBe("published");
    expect(created.publishedAt).toEqual(expect.any(Number));
    expect(created.sourceGpxFileId).toBe("f1");
    expect(created).not.toHaveProperty("conDay");

    expect(mocks.fileSet).toHaveBeenCalledWith({ publishedRouteId: body.routeId });
  });

  it("names the route after the file, without the .gpx extension", async () => {
    const body = await (await PUT(req({ state: "public" }), ctx)).json();
    expect(body.routeId).toEqual(expect.any(String));
    const created = mocks.routeCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.name).toBe("strip-loop");
  });

  it("reuses the existing Route instead of minting a second one", async () => {
    mocks.fileGet.mockResolvedValue(
      activeFile({ publishedRouteId: "r-existing" })
    );
    mocks.routeGet.mockResolvedValue({
      data: {
        routeId: "r-existing",
        ownerId: OWNER,
        status: "active",
        visibility: "private",
        copyCount: 7,
      },
    });

    const body = await (await PUT(req({ state: "public" }), ctx)).json();

    expect(body.routeId).toBe("r-existing");
    expect(mocks.routeCreate).not.toHaveBeenCalled();
    expect(mocks.s3Send).toHaveBeenCalledTimes(1); // content refreshed, not re-minted
    expect(mocks.routeSet).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "published" })
    );
  });

  it("429s when the publish cap is reached", async () => {
    mocks.routeByOwner.mockResolvedValue({
      data: Array.from({ length: 20 }, (_, i) => ({
        routeId: `r${i}`,
        status: "active",
        visibility: "published",
      })),
    });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(429);
  });

  it("429s when the total route cap is reached", async () => {
    mocks.routeByOwner.mockResolvedValue({
      data: Array.from({ length: 50 }, (_, i) => ({
        routeId: `r${i}`,
        status: "active",
        visibility: "private",
      })),
    });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(429);
  });

  it("does not cap an admin", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: OWNER, name: "Runner", services: ["gpxstudio", "admin"] },
    });
    mocks.routeByOwner.mockResolvedValue({
      data: Array.from({ length: 60 }, (_, i) => ({
        routeId: `r${i}`,
        status: "active",
        visibility: "published",
      })),
    });
    expect((await PUT(req({ state: "public" }), ctx)).status).toBe(200);
  });
});

describe("Strava compliance", () => {
  it("auto-converts a raw import and publishes the converted copy, not the import", async () => {
    mocks.fileGet.mockResolvedValue(
      activeFile({
        publicShareEligible: false,
        source: "strava",
        stravaActivityId: "9",
      })
    );

    const body = await (await PUT(req({ state: "public" }), ctx)).json();
    const created = mocks.routeCreate.mock.calls[0][0] as Record<string, unknown>;

    expect(body.state).toBe("public");
    expect(created.source).toBe("converted");
    // The converted route must not carry the Strava activity id forward.
    expect(created).not.toHaveProperty("stravaActivityId");
  });

  it("never publishes a non-active file", async () => {
    mocks.fileGet.mockResolvedValue(activeFile({ status: "pending" }));
    const response = await PUT(req({ state: "public" }), ctx);
    expect(response.status).toBe(400);
    expect(mocks.routeCreate).not.toHaveBeenCalled();
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });
});

describe("public -> private", () => {
  it("unpublishes but keeps the Route row so copyCount survives", async () => {
    mocks.fileGet.mockResolvedValue(
      activeFile({ publishedRouteId: "r-existing" })
    );
    mocks.routeGet.mockResolvedValue({
      data: {
        routeId: "r-existing",
        ownerId: OWNER,
        status: "active",
        visibility: "published",
        copyCount: 7,
      },
    });

    const body = await (await PUT(req({ state: "private" }), ctx)).json();

    expect(body.state).toBe("private");
    expect(mocks.routeSet).toHaveBeenCalledWith({ visibility: "private" });
    expect(mocks.routeRemove).toHaveBeenCalledWith(["publishedAt"]);
    expect(mocks.fileRemove).toHaveBeenCalledWith(["publishedRouteId"]);
  });

  it("survives a linked Route that no longer exists", async () => {
    mocks.fileGet.mockResolvedValue(activeFile({ publishedRouteId: "r-gone" }));
    mocks.routeGet.mockResolvedValue({ data: null });

    const response = await PUT(req({ state: "private" }), ctx);
    expect(response.status).toBe(200);
    expect(mocks.fileRemove).toHaveBeenCalledWith(["publishedRouteId"]);
  });

  it("ignores a linked Route owned by somebody else", async () => {
    mocks.fileGet.mockResolvedValue(activeFile({ publishedRouteId: "r-theirs" }));
    mocks.routeGet.mockResolvedValue({
      data: { routeId: "r-theirs", ownerId: "somebody-else", visibility: "published" },
    });

    const response = await PUT(req({ state: "private" }), ctx);
    expect(response.status).toBe(200);
    expect(mocks.routeSet).not.toHaveBeenCalled();
  });
});

describe("link state", () => {
  it("mints a public token share and returns its URL", async () => {
    const body = await (await PUT(req({ state: "link" }), ctx)).json();

    expect(body.state).toBe("link");
    expect(body.shareUrl).toContain("/studio/share/");
    expect(mocks.shareCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        fileId: "f1",
        ownerId: OWNER,
        accessMode: "public",
      })
    );
  });

  it("revokes every live token when going back to private", async () => {
    mocks.shareByFile.mockResolvedValue({
      data: [{ shareId: "s1" }, { shareId: "s2" }],
    });

    await PUT(req({ state: "private" }), ctx);

    expect(mocks.shareDelete).toHaveBeenCalledTimes(2);
  });

  it("revokes live tokens when going public — the states are exclusive", async () => {
    mocks.shareByFile.mockResolvedValue({ data: [{ shareId: "s1" }] });

    await PUT(req({ state: "public" }), ctx);

    expect(mocks.shareDelete).toHaveBeenCalledTimes(1);
  });
});
