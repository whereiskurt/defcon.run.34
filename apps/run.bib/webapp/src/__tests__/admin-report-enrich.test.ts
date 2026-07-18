import { describe, it, expect, vi } from "vitest";

const mockGetSocialQrHash = vi.fn();
const mockGetRunnerEmail = vi.fn();

vi.mock("@/lib/social-qr", () => ({
  getSocialQrHash: (sub: string) => mockGetSocialQrHash(sub),
  buildSocialQrUrl: (hash: string) => `https://run.defcon.run/use1/r?h=${hash}`,
}));
vi.mock("@/lib/runner-email", () => ({
  getRunnerEmail: (sub: string) => mockGetRunnerEmail(sub),
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
  it("fills email from run.auth and qrUrl from run.human", async () => {
    mockGetRunnerEmail.mockResolvedValue("a@x.com");
    mockGetSocialQrHash.mockResolvedValue("H1");
    const [row] = await enrichPrintNames([{ ...baseRow }], 4);
    expect(row.email).toBe("a@x.com");
    expect(row.qrUrl).toBe("https://run.defcon.run/use1/r?h=H1");
  });

  it("keeps the run.auth email and falls qrUrl back to runnerCode when the QR lookup misses", async () => {
    // A run.human miss must NOT blank the email, and qrUrl falls back to the
    // runner-code QR (mirrors the physical bib — never a blank stub, SC34.8).
    mockGetRunnerEmail.mockResolvedValue("a@x.com");
    mockGetSocialQrHash.mockResolvedValue(null);
    const [row] = await enrichPrintNames([{ ...baseRow }], 4);
    expect(row.email).toBe("a@x.com");
    expect(row.qrUrl).toBe("BIB-1"); // runnerCode fallback
  });

  it("blanks email but keeps the social qrUrl when only run.auth misses", async () => {
    mockGetRunnerEmail.mockResolvedValue(null);
    mockGetSocialQrHash.mockResolvedValue("H1");
    const [row] = await enrichPrintNames([{ ...baseRow }], 4);
    expect(row.email).toBe("");
    expect(row.qrUrl).toBe("https://run.defcon.run/use1/r?h=H1");
  });

  it("blanks email and falls qrUrl back to runnerCode when both lookups miss", async () => {
    mockGetRunnerEmail.mockResolvedValue(null);
    mockGetSocialQrHash.mockResolvedValue(null);
    const [row] = await enrichPrintNames([{ ...baseRow }], 4);
    expect(row.email).toBe("");
    expect(row.qrUrl).toBe("BIB-1"); // runnerCode fallback, never blank
  });

  it("empty ownerSub → blank email but qrUrl still falls back to runnerCode, no lookups", async () => {
    mockGetRunnerEmail.mockReset();
    mockGetSocialQrHash.mockReset();
    const [row] = await enrichPrintNames([{ ...baseRow, ownerSub: "" }], 4);
    expect(row.email).toBe("");
    expect(row.qrUrl).toBe("BIB-1"); // runner-code QR even with no ownerSub
    expect(mockGetRunnerEmail).not.toHaveBeenCalled();
    expect(mockGetSocialQrHash).not.toHaveBeenCalled();
  });
});
