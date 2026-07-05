import { describe, it, expect } from "vitest";

import {
  buildReports,
  isRegistered,
  reportToCsv,
  formatUsd,
  toCsv,
  PRINT_GATE_CENTS,
  type ReportInput,
} from "@/lib/admin-reports";

// Minimal fixtures — only the fields buildReports reads.
const bib = (over: Record<string, unknown>) =>
  ({
    ownerSub: "s",
    runnerCode: "bib-0000",
    nameOnBib: "",
    paidAmount: 0,
    paidStatusHistory: [],
    nameLocked: false,
    willPayInPerson: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }) as unknown as ReportInput["bibs"][number];

const baseInput = (): ReportInput => ({
  bibs: [
    bib({
      runnerCode: "bib-paid",
      nameOnBib: "ALICE",
      paidAmount: 2000,
      paidStatusHistory: [
        { provider: "stripe", amount: 2000, timestamp: "2026-07-03T10:00:00Z" },
      ],
    }),
    bib({
      runnerCode: "bib-cheap",
      nameOnBib: "BOB",
      paidAmount: 500, // below the $10 gate
    }),
    bib({
      runnerCode: "bib-locked",
      nameOnBib: "CAROL",
      paidAmount: 0,
      nameLocked: true, // eligible via lock
    }),
    bib({
      runnerCode: "bib-noname",
      nameOnBib: "", // excluded from print list
      willPayInPerson: true, // in-person pledge, unpaid
    }),
    bib({
      // Phantom visit-created bib: no name, $0 paid, no pledge → NOT registered.
      // Must be filtered from totals.bibs and the registrations roster (SC34.1).
      ownerSub: "sub-empty",
      runnerCode: "bib-empty",
      nameOnBib: "",
      paidAmount: 0,
      willPayInPerson: false,
    }),
  ],
  donations: [
    { amountCents: 20000, provider: "stripe", ownerSub: "s", createdAt: "2026-07-03T09:00:00Z" },
  ],
  reconciles: [
    { status: "unmatched", provider: "venmo", extractedAmount: 1500, extractedSenderName: "DAVE", receiptId: "r1" },
    { status: "matched", provider: "cashapp", extractedAmount: 1000 }, // excluded (matched)
  ],
  pendings: [
    {
      pendingId: "pending:sub-paid:bib:venmo:2500",
      ownerSub: "sub-paid",
      kind: "bib",
      provider: "venmo",
      amountCents: 2500,
      runnerCode: "bib-paid",
      createdAt: "2026-07-03T08:00:00Z",
    },
  ],
});

describe("buildReports()", () => {
  const r = buildReports(baseInput());

  it("print-names excludes unnamed bibs and flags eligibility", () => {
    expect(r.printNames.map((x) => x.runnerCode)).not.toContain("bib-noname");
    const byCode = Object.fromEntries(r.printNames.map((x) => [x.runnerCode, x]));
    expect(byCode["bib-paid"].printEligible).toBe(true); // $20 ≥ gate
    expect(byCode["bib-cheap"].printEligible).toBe(false); // $5 < gate
    expect(byCode["bib-locked"].printEligible).toBe(false); // locked but $0 paid
  });

  it("print-names sorts eligible first", () => {
    expect(r.printNames[0].printEligible).toBe(true);
    expect(r.printNames[r.printNames.length - 1].printEligible).toBe(false);
  });

  it("payments merges bib history + donations with a provider breakdown", () => {
    // one bib payment (2000) + one donation (20000)
    expect(r.payments.rows).toHaveLength(2);
    expect(r.payments.totalCents).toBe(22000);
    expect(r.payments.byProvider.stripe).toBe(22000);
  });

  it("outstanding includes in-person pledge, pending intent, and unmatched reconcile only", () => {
    const sources = r.outstanding.map((x) => x.source).sort();
    expect(sources).toEqual(["in-person", "pending-intent", "reconcile"]);
    // matched reconcile excluded
    expect(r.outstanding.filter((x) => x.source === "reconcile")).toHaveLength(1);
  });

  it("registrations lists only registered bibs (empty phantom excluded)", () => {
    // 5 bibs in, but bib-empty (no name / $0 / no pledge) is filtered out.
    expect(r.registrations).toHaveLength(4);
    expect(r.registrations.map((x) => x.runnerCode)).not.toContain("bib-empty");
    // named / paid / pledged bibs are all kept.
    const codes = r.registrations.map((x) => x.runnerCode);
    expect(codes).toContain("bib-paid"); // paid + named
    expect(codes).toContain("bib-cheap"); // named
    expect(codes).toContain("bib-locked"); // named
    expect(codes).toContain("bib-noname"); // pledged-only, no name
  });

  it("registration rows carry ownerSub for the reject action", () => {
    const empty = r.registrations.find((x) => x.runnerCode === "bib-noname");
    expect(empty?.ownerSub).toBeDefined();
  });

  it("pending-intent outstanding rows carry pendingId, ownerSub and kind", () => {
    const pending = r.outstanding.find((x) => x.source === "pending-intent");
    expect(pending?.pendingId).toBe("pending:sub-paid:bib:venmo:2500");
    expect(pending?.ownerSub).toBe("sub-paid");
    expect(pending?.kind).toBe("bib");
  });

  it("totals sum correctly (bibs counts only registered)", () => {
    // 5 bibs in, but totals.bibs counts only the 4 registered ones.
    expect(r.totals.bibs).toBe(4);
    expect(r.totals.inPersonPledges).toBe(1);
    expect(r.totals.bibCollectedCents).toBe(2500); // 2000 + 500
    expect(r.totals.donationCents).toBe(20000);
    expect(r.totals.grandTotalCents).toBe(22500);
    expect(r.totals.printEligible).toBe(1); // only alice ($20 bib spend)
    expect(r.totals.pendingCount).toBe(2); // 1 pending + 1 unmatched reconcile
  });

  it("PRINT_GATE_CENTS is $20", () => {
    expect(PRINT_GATE_CENTS).toBe(2000);
  });
});

describe("isRegistered()", () => {
  it("is true when the bib has a non-empty (trimmed) name", () => {
    expect(isRegistered(bib({ nameOnBib: "ALICE" }))).toBe(true);
    expect(isRegistered(bib({ nameOnBib: "   " }))).toBe(false); // whitespace-only
  });

  it("is true when the bib has any payment", () => {
    expect(isRegistered(bib({ nameOnBib: "", paidAmount: 500 }))).toBe(true);
  });

  it("is true when the runner pledged to pay in person", () => {
    expect(isRegistered(bib({ nameOnBib: "", willPayInPerson: true }))).toBe(true);
  });

  it("is false for an empty visit-created bib", () => {
    expect(
      isRegistered(bib({ nameOnBib: "", paidAmount: 0, willPayInPerson: false }))
    ).toBe(false);
  });
});

describe("CSV helpers", () => {
  it("formatUsd formats cents", () => {
    expect(formatUsd(2000)).toBe("$20.00");
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("toCsv quotes cells containing commas/quotes/newlines", () => {
    const csv = toCsv(
      [
        { key: "a", header: "A" },
        { key: "b", header: "B" },
      ],
      [{ a: "plain", b: "has,comma" }, { a: 'quo"te', b: "line\nbreak" }]
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe("A,B");
    expect(lines[1]).toBe('plain,"has,comma"');
    expect(csv).toContain('"quo""te"');
  });

  it("reportToCsv print-names has a header row + one line per named bib", () => {
    const csv = reportToCsv(buildReports(baseInput()), "print-names");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("name,runnerCode,paidUsd,printEligible,nameLocked");
    expect(lines).toHaveLength(1 + 3); // header + 3 named bibs
  });
});
