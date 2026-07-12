import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeSyncedName,
  syncRabbitName,
  maybeSyncRabbitName,
} from "@/lib/rabbit-name-sync";

describe("normalizeSyncedName", () => {
  it("nulls empty / 1-2 char names, trims, and truncates to 20", () => {
    expect(normalizeSyncedName("")).toBeNull();
    expect(normalizeSyncedName("ab")).toBeNull();
    expect(normalizeSyncedName("  OGRE ")).toBe("OGRE");
    expect(normalizeSyncedName("abcdefghijklmnopqrstuvwx")).toBe(
      "abcdefghijklmnopqrst"
    );
  });
});

describe("syncRabbitName", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("PATCHes the internal endpoint and returns true on ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncRabbitName("sub-1", "OGRE")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/internal/user/sub-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ displayName: "OGRE" });
    expect(init.headers["X-Internal-Secret"]).toBeDefined();
  });

  it("returns false on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(syncRabbitName("sub-2", "OGRE")).resolves.toBe(false);
  });

  it("returns false (never throws) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(syncRabbitName("sub-3", "OGRE")).resolves.toBe(false);
  });
});

describe("maybeSyncRabbitName", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips a too-short name without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(maybeSyncRabbitName("sub-1", "ab")).resolves.toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates then syncs a long name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      maybeSyncRabbitName("sub-1", "abcdefghijklmnopqrstuvwx")
    ).resolves.toBe("synced");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      displayName: "abcdefghijklmnopqrst",
    });
  });

  it("returns 'failed' (never throws) when the sync errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(maybeSyncRabbitName("sub-1", "OGRE")).resolves.toBe("failed");
  });
});
