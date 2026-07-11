import { describe, it, expect, vi } from "vitest";

const mockGetRunnerContact = vi.fn();
vi.mock("@/lib/social-qr", () => ({
  getRunnerContact: (sub: string) => mockGetRunnerContact(sub),
  buildSocialQrUrl: (hash: string) => `https://run.defcon.run/use1/r?h=${hash}`,
}));

import { mapWithConcurrency, enrichPrintNames } from "@/lib/admin-report-enrich";

const baseRow = {
  nameOnBib: "R",
  runnerCode: "BIB-1",
  ownerSub: "sub-1",
  paidAmountCents: 2000,
  nameLocked: false,
  printEligible: true,
  paymentTypes: "stripe",
};

describe("mapWithConcurrency()", () => {
  it("preserves order and never runs more than `limit` at once", async () => {
    let active = 0;
    let peak = 0;
    const fn = async (n: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    };
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, fn);
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("enrichPrintNames()", () => {
  it("fills email + qrUrl from getRunnerContact", async () => {
    mockGetRunnerContact.mockResolvedValue({ hash: "H1", email: "a@x.com" });
    const [row] = await enrichPrintNames([{ ...baseRow }], 4);
    expect(row.email).toBe("a@x.com");
    expect(row.qrUrl).toBe("https://run.defcon.run/use1/r?h=H1");
  });

  it("blanks email/qrUrl when the lookup returns nulls", async () => {
    mockGetRunnerContact.mockResolvedValue({ hash: null, email: null });
    const [row] = await enrichPrintNames([{ ...baseRow }], 4);
    expect(row.email).toBe("");
    expect(row.qrUrl).toBe("");
  });

  it("blanks a row whose ownerSub is empty without calling the client", async () => {
    mockGetRunnerContact.mockReset();
    const [row] = await enrichPrintNames([{ ...baseRow, ownerSub: "" }], 4);
    expect(row.email).toBe("");
    expect(row.qrUrl).toBe("");
    expect(mockGetRunnerContact).not.toHaveBeenCalled();
  });
});
