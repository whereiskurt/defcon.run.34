import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for listAllProfileServices (Phase 43 admin Services column).
 *
 * listAllProfileServices issues exactly ONE scan over the AuthProfile entity
 * (`pages: "all"`) and maps each row to the bulk shape consumed by run.human:
 *   { sub, services }
 * where `sub` is the AuthProfile `userId` (== OIDC sub) and `services` defaults
 * to `[]` when the row omits it.
 *
 * The `@/entities/auth-profile` module is mocked so AuthProfile.scan.go(...)
 * resolves to a fixed `data` fixture — no live DynamoDB. Mirrors the injected-
 * fake style of quota.by-type.test.ts while exercising the mapping, the
 * empty-services default, the empty-result case, and the single-scan guarantee.
 */

const { goMock } = vi.hoisted(() => {
  const goMock = vi.fn();
  return { goMock };
});

vi.mock("@/entities/auth-profile", () => ({
  AuthProfile: {
    scan: {
      go: goMock,
    },
  },
}));

import { listAllProfileServices } from "./auth-profile";

describe("listAllProfileServices", () => {
  beforeEach(() => {
    goMock.mockReset();
  });

  it("maps every scanned row to { sub, services } (sub = userId)", async () => {
    goMock.mockResolvedValue({
      data: [
        { userId: "sub-a", services: ["auth", "run", "gpxstudio"] },
        { userId: "sub-b", services: ["auth", "run"] },
      ],
    });

    const result = await listAllProfileServices();

    expect(result).toEqual([
      { sub: "sub-a", services: ["auth", "run", "gpxstudio"] },
      { sub: "sub-b", services: ["auth", "run"] },
    ]);
  });

  it("defaults services to [] when the source row omits it", async () => {
    goMock.mockResolvedValue({
      data: [{ userId: "sub-c" }],
    });

    const result = await listAllProfileServices();

    expect(result).toEqual([{ sub: "sub-c", services: [] }]);
  });

  it("resolves to [] when the scan returns no rows", async () => {
    goMock.mockResolvedValue({ data: [] });

    const result = await listAllProfileServices();

    expect(result).toEqual([]);
  });

  it("issues exactly ONE scan with pages: 'all' (no per-user fan-out)", async () => {
    goMock.mockResolvedValue({ data: [] });

    await listAllProfileServices();

    expect(goMock).toHaveBeenCalledTimes(1);
    expect(goMock).toHaveBeenCalledWith({ pages: "all" });
  });
});
