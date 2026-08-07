import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveOwners, clearOwnerCache } from "@/lib/owner-directory";

const OLD_ENV = { ...process.env };

/** run.human's `?summary=1` answer. Note: no email, no MQTT credentials. */
const ok = (displayName: string) =>
  new Response(JSON.stringify({ found: true, runUserId: "u", displayName }), {
    status: 200,
  });

beforeEach(() => {
  clearOwnerCache();
  process.env.AUTH_INTERNAL_SECRET = "s3cret";
  // The var humanBaseUrl() actually reads — without it the URL falls back to a
  // localhost dev default, which would make the assertions below vacuous.
  process.env.RUN_HUMAN_INTERNAL_URL = "https://human.test";
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("resolveOwners", () => {
  it("resolves names and sends the internal secret", async () => {
    const fetchImpl = vi.fn(async () => ok("SwiftRabbit")) as unknown as typeof fetch;

    const owners = await resolveOwners(["sub-1"], { fetchImpl });

    expect(owners.get("sub-1")).toEqual({ displayName: "SwiftRabbit" });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["X-Internal-Secret"]).toBe("s3cret");
  });

  it("asks for the least-privilege summary form, never the full profile", async () => {
    const fetchImpl = vi.fn(async () => ok("A")) as unknown as typeof fetch;

    await resolveOwners(["sub-1"], { fetchImpl });

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe(
      "https://human.test/api/internal/user/sub-1?summary=1"
    );
    // The unsummarised endpoint returns the runner's email AND their MQTT
    // password. Dropping this param would quietly pull both onto an admin page.
    expect(String(url)).toContain("summary=1");
  });

  it("returns no name for a 404 — a runner with no run.human identity", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 404 })
    ) as unknown as typeof fetch;

    expect((await resolveOwners(["sub-1"], { fetchImpl })).size).toBe(0);
  });

  it("swallows a thrown lookup — the roster must still render", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("run.human down");
    }) as unknown as typeof fetch;

    await expect(resolveOwners(["sub-1"], { fetchImpl })).resolves.toEqual(new Map());
  });

  it("resolves nothing, and calls nothing, without the shared secret", async () => {
    delete process.env.AUTH_INTERNAL_SECRET;
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    expect((await resolveOwners(["sub-1"], { fetchImpl })).size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches a hit — a second roster load costs no round-trips", async () => {
    const fetchImpl = vi.fn(async () => ok("SwiftRabbit")) as unknown as typeof fetch;

    await resolveOwners(["sub-1"], { fetchImpl });
    const second = await resolveOwners(["sub-1"], { fetchImpl });

    expect(second.get("sub-1")).toEqual({ displayName: "SwiftRabbit" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches a definitive miss too, so unknown runners are not re-requested", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 404 })
    ) as unknown as typeof fetch;

    await resolveOwners(["sub-1"], { fetchImpl });
    await resolveOwners(["sub-1"], { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a transient failure — the next load retries", async () => {
    const failing = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    await resolveOwners(["sub-1"], { fetchImpl: failing });

    const recovered = vi.fn(async () => ok("SwiftRabbit")) as unknown as typeof fetch;
    const owners = await resolveOwners(["sub-1"], { fetchImpl: recovered });

    expect(owners.get("sub-1")).toEqual({ displayName: "SwiftRabbit" });
  });

  it("re-fetches once the TTL has expired", async () => {
    const fetchImpl = vi.fn(async () => ok("SwiftRabbit")) as unknown as typeof fetch;
    let clock = 1_000_000;

    await resolveOwners(["sub-1"], { fetchImpl, now: () => clock });
    clock += 11 * 60 * 1000;
    await resolveOwners(["sub-1"], { fetchImpl, now: () => clock });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
