import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PendingContribution tests (v1.5 "live pending view").
 *
 * Load-bearing invariants:
 *   - pendingContributionId is DETERMINISTIC on (ownerSub, kind, provider,
 *     amount) so a handoff-page refresh upserts the same row instead of
 *     piling up duplicates.
 *   - recordPending upserts with that key + a truncated non-negative amount.
 *   - clearPendingForOwner deletes ONLY the rows matching (kind, provider) —
 *     a Venmo bib reconcile must not wipe a CashApp donation intent.
 */

const mockUpsert = vi.fn();
const mockDelete = vi.fn();
const mockScan = vi.fn();

vi.mock("electrodb", () => {
  class Entity {
    constructor(_schema: unknown, _opts: unknown) {}
    upsert(input: unknown) {
      return { go: () => mockUpsert(input) };
    }
    delete(key: unknown) {
      return { go: () => mockDelete(key) };
    }
    scan = {
      where: (_fn: unknown) => ({ go: () => mockScan() }),
    };
  }
  return { Entity };
});

vi.mock("@/entities/client", () => ({
  electroClient: {},
  ELECTRO_TABLE: "run-human-electro-mock",
}));

import {
  pendingContributionId,
  recordPending,
  clearPendingForOwner,
  clearPendingById,
} from "@/entities/pending-contribution";

describe("pendingContributionId()", () => {
  it("is deterministic for the same tuple", () => {
    const a = pendingContributionId("u1", "bib", "venmo", 2000);
    const b = pendingContributionId("u1", "bib", "venmo", 2000);
    expect(a).toBe(b);
    expect(a).toBe("pending:u1:bib:venmo:2000");
  });

  it("differs when any component of the tuple differs", () => {
    const base = pendingContributionId("u1", "bib", "venmo", 2000);
    expect(pendingContributionId("u2", "bib", "venmo", 2000)).not.toBe(base);
    expect(pendingContributionId("u1", "donation", "venmo", 2000)).not.toBe(base);
    expect(pendingContributionId("u1", "bib", "cashapp", 2000)).not.toBe(base);
    expect(pendingContributionId("u1", "bib", "venmo", 2500)).not.toBe(base);
  });

  it("truncates fractional cents into the key", () => {
    expect(pendingContributionId("u1", "bib", "venmo", 2000.9)).toBe(
      "pending:u1:bib:venmo:2000"
    );
  });
});

describe("recordPending()", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({ data: { pendingId: "x" } });
  });

  it("upserts under the deterministic key with a clamped amount", async () => {
    await recordPending({
      ownerSub: "u1",
      kind: "bib",
      provider: "cashapp",
      amountCents: -50,
      runnerCode: "BIB-1234",
    });
    const payload = mockUpsert.mock.calls[0][0];
    expect(payload.pendingId).toBe("pending:u1:bib:cashapp:0");
    expect(payload.amountCents).toBe(0);
    expect(payload.runnerCode).toBe("BIB-1234");
    expect(typeof payload.createdAt).toBe("string");
  });

  it("defaults runnerCode to empty string for donation intents", async () => {
    await recordPending({
      ownerSub: "u1",
      kind: "donation",
      provider: "venmo",
      amountCents: 1000,
    });
    expect(mockUpsert.mock.calls[0][0].runnerCode).toBe("");
  });
});

describe("clearPendingForOwner()", () => {
  beforeEach(() => {
    mockDelete.mockReset();
    mockDelete.mockResolvedValue({ data: {} });
    mockScan.mockReset();
  });

  it("deletes only rows matching the (kind, provider) bucket", async () => {
    mockScan.mockResolvedValue({
      data: [
        { pendingId: "keep-donation", kind: "donation", provider: "venmo" },
        { pendingId: "keep-cashapp", kind: "bib", provider: "cashapp" },
        { pendingId: "clear-me", kind: "bib", provider: "venmo" },
      ],
    });
    await clearPendingForOwner("u1", "bib", "venmo");
    const deleted = mockDelete.mock.calls.map((c) => c[0].pendingId);
    expect(deleted).toEqual(["clear-me"]);
  });

  it("no-ops when nothing matches", async () => {
    mockScan.mockResolvedValue({ data: [] });
    await clearPendingForOwner("u1", "bib", "venmo");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("clearPendingById()", () => {
  beforeEach(() => {
    mockDelete.mockReset();
    mockDelete.mockResolvedValue({ data: {} });
    mockScan.mockReset();
  });

  it("deletes exactly the one pendingId (never scans the bucket)", async () => {
    // WR-01: the admin reconcile path targets a single intent so a second
    // same-provider intent for a different amount survives on the dashboard.
    await clearPendingById("pending:u1:bib:venmo:2000");
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockDelete.mock.calls.map((c) => c[0].pendingId)).toEqual([
      "pending:u1:bib:venmo:2000",
    ]);
  });
});
