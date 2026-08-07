import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers the three READ surfaces the moderation page added: the roster's owner
 * join, the shapes endpoint, and the Strava payload lookup. The moderation
 * WRITE paths (hide / delete) are covered by admin-heatmap.test.ts — kept
 * separate because these need a scan + S3 body mock the write tests do not.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  scanGo: vi.fn(),
  fileGet: vi.fn(),
  s3Send: vi.fn(),
  resolveOwners: vi.fn(),
  readStripCache: vi.fn(),
}));

vi.mock("@/config/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/s3-client", () => ({
  s3Client: { send: mocks.s3Send },
  BUCKET: "test-bucket",
}));
vi.mock("@/entities/gpx-file", () => ({
  GpxFile: {
    scan: { where: () => ({ go: mocks.scanGo }) },
    get: (k: unknown) => ({ go: () => mocks.fileGet(k) }),
  },
}));
vi.mock("@/lib/owner-directory", () => ({ resolveOwners: mocks.resolveOwners }));
vi.mock("@/lib/strava-sync", () => ({ readStripCache: mocks.readStripCache }));

import { GET as rosterGET } from "./route";
import { GET as shapesGET } from "./shapes/route";
import { GET as stravaGET } from "./[fileId]/strava/route";

const ADMIN = { user: { id: "admin-sub", services: ["gpxstudio", "admin"] } };
const NON_ADMIN = { user: { id: "runner-sub", services: ["gpxstudio"] } };

/** A real Vegas track, long enough that the shape builder has something to draw. */
const GPX = `<gpx><trk><trkseg>${Array.from({ length: 40 }, (_, i) => {
  const lat = (36.114 + i * 0.0002).toFixed(6);
  const lon = (-115.172 + i * 0.0004).toFixed(6);
  return `<trkpt lat="${lat}" lon="${lon}"><time>2026-08-06T13:0${
    i < 10 ? "0" : "1"
  }:0${i % 10}Z</time></trkpt>`;
}).join("")}</trkseg></trk></gpx>`;

const row = (over: Record<string, unknown> = {}) => ({
  userId: "owner-1",
  fileId: "f1",
  fileName: "Morning Run.gpx",
  bucket: "test-bucket",
  key: "uploads/owner-1/f1.gpx",
  status: "active",
  conDay: "2026-08-06",
  createdAt: 1_754_000_000_000,
  updatedAt: 1_754_000_000_000,
  ...over,
});

const s3Body = (text: string) => ({
  Body: { transformToString: async () => text },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(ADMIN);
  mocks.scanGo.mockResolvedValue({ data: [row()] });
  mocks.s3Send.mockResolvedValue(s3Body(GPX));
  mocks.resolveOwners.mockResolvedValue(new Map());
});

describe("gates — every inspection surface is non-disclosure", () => {
  it("401s all three with no session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await rosterGET()).status).toBe(401);
    expect((await shapesGET()).status).toBe(401);
    expect((await stravaGET(req(), ctx())).status).toBe(401);
  });

  it("404s a non-admin — never 403", async () => {
    mocks.auth.mockResolvedValue(NON_ADMIN);
    expect((await rosterGET()).status).toBe(404);
    expect((await shapesGET()).status).toBe(404);
    expect((await stravaGET(req(), ctx())).status).toBe(404);
    // The gate must come BEFORE any data access.
    expect(mocks.scanGo).not.toHaveBeenCalled();
    expect(mocks.readStripCache).not.toHaveBeenCalled();
  });
});

describe("roster — owner join", () => {
  it("attaches the display name and NEVER an email", async () => {
    mocks.resolveOwners.mockResolvedValue(
      new Map([["owner-1", { displayName: "SwiftRabbit" }]])
    );
    // No artifact in S3 — the roster must still answer.
    mocks.s3Send.mockRejectedValue(new Error("no artifact"));

    const body = await (await rosterGET()).json();

    expect(body.runs[0].owner).toEqual({ displayName: "SwiftRabbit" });
    // Kurt, 2026-08-07: no email on this surface, ever.
    expect(JSON.stringify(body)).not.toContain("email");
  });

  it("passes DISTINCT userIds — five runs by one runner is one lookup", async () => {
    mocks.scanGo.mockResolvedValue({
      data: Array.from({ length: 5 }, (_, i) => row({ fileId: `f${i}` })),
    });
    mocks.s3Send.mockRejectedValue(new Error("no artifact"));

    await rosterGET();

    expect(mocks.resolveOwners).toHaveBeenCalledWith(["owner-1"]);
  });

  it("leaves rows unresolved rather than failing when the directory is empty", async () => {
    mocks.resolveOwners.mockResolvedValue(new Map());
    mocks.s3Send.mockRejectedValue(new Error("no artifact"));

    const res = await rosterGET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runs[0].owner).toBeUndefined();
  });
});

describe("shapes", () => {
  it("returns a drawable path keyed by fileId", async () => {
    const body = await (await shapesGET()).json();

    expect(body.shapes.f1.path.startsWith("M")).toBe(true);
    expect(body.shapes.f1.points).toBe(40);
    expect(body.failed).toEqual([]);
  });

  it("degrades ONE unreadable object to failed[] instead of a 500", async () => {
    mocks.scanGo.mockResolvedValue({
      data: [row({ fileId: "ok" }), row({ fileId: "broken" })],
    });
    mocks.s3Send.mockImplementation(async (cmd: { input: { Key: string } }) =>
      cmd.input.Key.includes("broken") ? Promise.reject(new Error("gone")) : s3Body(GPX)
    );
    // Distinct keys so the mock can tell them apart.
    mocks.scanGo.mockResolvedValue({
      data: [
        row({ fileId: "ok", key: "uploads/owner-1/ok.gpx" }),
        row({ fileId: "broken", key: "uploads/owner-1/broken.gpx" }),
      ],
    });

    const res = await shapesGET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.shapes.ok).toBeDefined();
    expect(body.failed).toEqual(["broken"]);
  });

  it("skips rows whose conDay is not a real con day", async () => {
    mocks.scanGo.mockResolvedValue({
      data: [row({ fileId: "f1", conDay: "1999-01-01" })],
    });

    const body = await (await shapesGET()).json();

    expect(body.shapes).toEqual({});
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });
});

describe("strava payload — a miss is not an absence", () => {
  it("returns the cached activity when the snapshot has it", async () => {
    mocks.fileGet.mockResolvedValue({ data: row({ stravaActivityId: "999" }) });
    mocks.readStripCache.mockResolvedValue({
      activities: [{ id: 999, name: "Morning Run" }],
      weeks: 4,
      fetchedAt: 1_754_000_000_000,
    });

    const body = await (await stravaGET(req(), ctx())).json();

    expect(body.found).toBe(true);
    expect(body.activity.name).toBe("Morning Run");
  });

  it("distinguishes not-strava from an empty cache from a trimmed snapshot", async () => {
    mocks.fileGet.mockResolvedValue({ data: row({ source: "upload" }) });
    expect((await (await stravaGET(req(), ctx())).json()).reason).toBe("not-strava");

    mocks.fileGet.mockResolvedValue({ data: row({ stravaActivityId: "999" }) });
    mocks.readStripCache.mockResolvedValue(null);
    expect((await (await stravaGET(req(), ctx())).json()).reason).toBe("no-cache");

    mocks.readStripCache.mockResolvedValue({
      activities: [{ id: 111 }],
      weeks: 4,
      fetchedAt: 1_754_000_000_000,
    });
    const trimmed = await (await stravaGET(req(), ctx())).json();
    expect(trimmed.reason).toBe("not-in-snapshot");
    // The UI needs these to explain WHY it is missing rather than implying
    // the activity was fabricated.
    expect(trimmed.snapshotSize).toBe(1);
    expect(trimmed.fetchedAt).toBe(1_754_000_000_000);
  });

  it("400s without userId — the pk needs the owner, not the session", async () => {
    const res = await stravaGET(
      new Request("http://localhost/api/gpx/admin/heatmap/f1/strava"),
      ctx()
    );
    expect(res.status).toBe(400);
  });

  it("never calls Strava", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mocks.fileGet.mockResolvedValue({ data: row({ stravaActivityId: "999" }) });
    mocks.readStripCache.mockResolvedValue({
      activities: [{ id: 999 }],
      weeks: 4,
      fetchedAt: 1,
    });

    await stravaGET(req(), ctx());

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

function req(qs = "?userId=owner-1") {
  return new Request(`http://localhost/api/gpx/admin/heatmap/f1/strava${qs}`);
}
function ctx() {
  return { params: Promise.resolve({ fileId: "f1" }) };
}
