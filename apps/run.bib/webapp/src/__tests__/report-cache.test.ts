import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/cache BEFORE importing the module under test.
// unstable_cache is stubbed to a pass-through factory so importing the module
// (which calls unstable_cache at load time) doesn't touch Next's request scope.
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

// The wrapped scan functions are irrelevant to the tag-contract test; stub them.
vi.mock("@/lib/admin-reports", () => ({ loadReports: vi.fn() }));
vi.mock("@/entities/general-donation", () => ({ listDonationsForOwner: vi.fn() }));
vi.mock("@/entities/pending-contribution", () => ({ listPendingForOwner: vi.fn() }));

import {
  invalidateBib,
  invalidateOwner,
  invalidateReports,
} from "@/lib/report-cache";

afterEach(() => revalidateTag.mockClear());

// Next 16 requires a profile arg; { expire: 0 } = immediate hard expiry.
// Asserting it is part of the contract — SWR profiles would serve stale data.
const IMMEDIATE = { expire: 0 };

describe("report-cache invalidation tag contract", () => {
  it("invalidateReports hits only the aggregate tag with immediate expiry", () => {
    invalidateReports();
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("bib:reports", IMMEDIATE);
  });

  it("invalidateBib hits both the aggregate and the owner tag", () => {
    invalidateBib("sub-123");
    expect(revalidateTag).toHaveBeenCalledWith("bib:reports", IMMEDIATE);
    expect(revalidateTag).toHaveBeenCalledWith("bib:owner:sub-123", IMMEDIATE);
    expect(revalidateTag).toHaveBeenCalledTimes(2);
  });

  it("invalidateOwner is a no-op for a null/empty sub", () => {
    invalidateOwner(null);
    invalidateOwner(undefined);
    invalidateOwner("");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("invalidateBib with a null sub still invalidates reports, skips owner", () => {
    invalidateBib(null);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("bib:reports", IMMEDIATE);
  });
});
