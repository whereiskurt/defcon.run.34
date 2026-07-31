import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Internal heat-map build route tests (Phase 71, HEAT-02, gap plan 71-11).
 *
 * Shape copied from the sibling `api/gpx/internal/reconcile/route.test.ts`, with
 * one deliberate divergence: every denial here asserts **404**, not 403. This
 * endpoint is reachable from the open internet until the 71-13 edge block lands
 * (71-VERIFICATION.md truth #24), so a 403 would confirm the path exists.
 */

const mocks = vi.hoisted(() => ({
  buildDc34Heatmap: vi.fn(async () => ({
    year: "dc34" as const,
    generatedAt: "2026-08-11T00:00:00.000Z",
    runCount: 3,
    totalKm: 12.5,
    scanned: 4,
    skipped: 1,
  })),
}));

vi.mock("@/lib/heatmap-build", () => ({
  buildDc34Heatmap: mocks.buildDc34Heatmap,
}));

import { POST } from "./route";

function req(header?: string) {
  const headers: Record<string, string> = {};
  if (header !== undefined) headers["x-internal-secret"] = header;
  return new Request("http://x/api/gpx/internal/heatmap-build", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildDc34Heatmap.mockResolvedValue({
    year: "dc34",
    generatedAt: "2026-08-11T00:00:00.000Z",
    runCount: 3,
    totalKm: 12.5,
    scanned: 4,
    skipped: 1,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/gpx/internal/heatmap-build — secret gate", () => {
  it("404s (never 403) when no secret header is sent, even with a valid secret configured", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct-horse-battery");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(mocks.buildDc34Heatmap).not.toHaveBeenCalled();
  });

  it("404s on a wrong secret of a DIFFERENT length without throwing (timingSafeEqual needs equal buffers)", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct-horse-battery");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req("short"));
    expect(res.status).toBe(404);
    expect(mocks.buildDc34Heatmap).not.toHaveBeenCalled();
  });

  it("404s on a wrong secret of the SAME length", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct-horse-battery");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req("wrongg-horse-battery"));
    expect(res.status).toBe(404);
    expect(mocks.buildDc34Heatmap).not.toHaveBeenCalled();
  });

  it("runs the build and 200s on the correct secret", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct-horse-battery");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req("correct-horse-battery"));
    expect(res.status).toBe(200);
    expect(mocks.buildDc34Heatmap).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      year: "dc34",
      runCount: 3,
    });
  });

  /**
   * IN-04. `??` only falls back on null/undefined, so an empty-string primary
   * variable — a trivially easy SSM/Terraform mistake — pinned this route to a
   * permanent silent rejection and the heat map silently stopped updating.
   */
  it("falls back to AUTH_INTERNAL_SECRET when INTERNAL_SYNC_SECRET is the EMPTY STRING (IN-04)", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", "");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "fallback-secret");
    const res = await POST(req("fallback-secret"));
    expect(res.status).toBe(200);
    expect(mocks.buildDc34Heatmap).toHaveBeenCalledTimes(1);
  });

  it("falls back to AUTH_INTERNAL_SECRET when INTERNAL_SYNC_SECRET is unset", async () => {
    vi.stubEnv("INTERNAL_SYNC_SECRET", undefined);
    vi.stubEnv("AUTH_INTERNAL_SECRET", "fallback-secret");
    const res = await POST(req("fallback-secret"));
    expect(res.status).toBe(200);
  });

  it("404s AND logs when neither variable is configured (IN-04 observability)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("INTERNAL_SYNC_SECRET", "");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    const res = await POST(req("anything"));
    expect(res.status).toBe(404);
    expect(mocks.buildDc34Heatmap).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toMatch(/\[heatmap\].*secret/i);
  });
});

describe("POST /api/gpx/internal/heatmap-build — build failure", () => {
  it("500s with a generic message when the build throws (T-71-08: no exception string to the caller)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("INTERNAL_SYNC_SECRET", "correct-horse-battery");
    vi.stubEnv("AUTH_INTERNAL_SECRET", "");
    mocks.buildDc34Heatmap.mockRejectedValue(
      new Error("s3://secret-bucket/uploads/HEATMAP/dc34.json AccessDenied")
    );
    const res = await POST(req("correct-horse-battery"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Heatmap build failed");
    expect(JSON.stringify(body)).not.toMatch(/AccessDenied|secret-bucket/);
  });
});
