import { describe, it, expect } from "vitest";

import {
  buildReports,
  buildDashboard,
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
    // Non-matching ownerSub → stays anonymous "(donation)" (no bib for this sub).
    { amountCents: 20000, provider: "stripe", ownerSub: "sub-anon", createdAt: "2026-07-03T09:00:00Z" },
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

  it("a donation with no matching bib stays anonymous", () => {
    const don = r.payments.rows.find((x) => x.kind === "donation");
    expect(don?.nameOnBib).toBe("(donation)");
    expect(don?.runnerCode).toBe("—");
  });

  it("a donation resolves the donor's name + runner code by ownerSub", () => {
    const input = baseInput();
    input.bibs.push(
      bib({
        ownerSub: "sub-obiwan",
        runnerCode: "bib-8q5g",
        nameOnBib: "OBIWAN",
        paidAmount: 2000,
      })
    );
    input.donations.push({
      amountCents: 3000,
      provider: "stripe",
      ownerSub: "sub-obiwan",
      createdAt: "2026-07-06T09:00:00Z",
    });
    const don = buildReports(input).payments.rows.find(
      (x) => x.kind === "donation" && x.amountCents === 3000
    );
    expect(don?.nameOnBib).toBe("OBIWAN");
    expect(don?.runnerCode).toBe("bib-8q5g");
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

describe("in-person pledge → $20 + print-eligible (Kurt 2026-07-05)", () => {
  // A NAMED runner who pledged to pay in person, no money moved yet.
  const input: ReportInput = {
    bibs: [
      bib({
        ownerSub: "sub-pledge",
        runnerCode: "bib-pledge",
        nameOnBib: "EVE",
        paidAmount: 0,
        willPayInPerson: true,
      }),
    ],
    donations: [],
    reconciles: [],
    pendings: [],
  };
  const r = buildReports(input);

  it("shows the named pledger on the print list at $20, print-eligible", () => {
    const row = r.printNames.find((x) => x.runnerCode === "bib-pledge");
    expect(row).toBeDefined();
    expect(row!.paidAmountCents).toBe(PRINT_GATE_CENTS);
    expect(row!.printEligible).toBe(true);
    expect(r.totals.printEligible).toBe(1);
  });

  it("outstanding in-person row shows $20 (not $0) and carries ownerSub for PAID", () => {
    const row = r.outstanding.find((x) => x.source === "in-person");
    expect(row).toBeDefined();
    expect(row!.amountCents).toBe(PRINT_GATE_CENTS);
    expect(row!.ownerSub).toBe("sub-pledge");
  });

  it("does NOT inflate collected revenue — the pledge is unreconciled", () => {
    // The $20 is a display/eligibility signal only; no real money booked yet.
    expect(r.totals.bibCollectedCents).toBe(0);
    expect(r.totals.grandTotalCents).toBe(0);
  });

  it("once the $20 is actually paid, it drops off the in-person outstanding list", () => {
    const paid = buildReports({
      ...input,
      bibs: [
        bib({
          ownerSub: "sub-pledge",
          runnerCode: "bib-pledge",
          nameOnBib: "EVE",
          paidAmount: 2000, // PAID action booked it
          willPayInPerson: true,
        }),
      ],
    });
    expect(paid.outstanding.filter((x) => x.source === "in-person")).toHaveLength(
      0
    );
    expect(paid.totals.bibCollectedCents).toBe(2000);
  });
});

describe("buildDashboard() — live-ops view-model (Kurt 2026-07-05)", () => {
  const NOW = Date.parse("2026-07-05T12:00:00Z");
  const input: ReportInput = {
    bibs: [
      bib({
        runnerCode: "bib-eve",
        nameOnBib: "EVE",
        paidAmount: 2000,
        paidStatusHistory: [
          { provider: "cash", amount: 2000, timestamp: "2026-07-05T11:00:00Z" }, // <24h
        ],
      }),
      bib({
        runnerCode: "bib-alice",
        nameOnBib: "ALICE",
        paidAmount: 4000,
        paidStatusHistory: [
          { provider: "stripe", amount: 4000, timestamp: "2026-07-03T10:00:00Z" }, // >24h
        ],
      }),
    ],
    donations: [
      // ownerSub with no bib → anonymous "a donor" in the ticker.
      { amountCents: 5000, provider: "stripe", ownerSub: "sub-anon", createdAt: "2026-07-05T09:00:00Z" }, // <24h
      { amountCents: 20000, provider: "stripe", ownerSub: "sub-anon", createdAt: "2026-07-01T09:00:00Z" }, // >24h
    ],
    reconciles: [],
    pendings: [],
  };
  const d = buildDashboard(buildReports(input), NOW);

  it("cumulative series is monotonic and ends at the grand total", () => {
    expect(d.series).toHaveLength(4);
    const last = d.series[d.series.length - 1];
    expect(last.bibCents).toBe(6000);
    expect(last.donCents).toBe(25000);
    expect(last.totalCents).toBe(31000);
    // never decreases
    for (let i = 1; i < d.series.length; i++) {
      expect(d.series[i].totalCents).toBeGreaterThanOrEqual(d.series[i - 1].totalCents);
    }
  });

  it("24h deltas count only the last-day money", () => {
    expect(d.bib24hCents).toBe(2000); // EVE only (ALICE is 2 days old)
    expect(d.don24hCents).toBe(5000); // $50 only ($200 is 4 days old)
    expect(d.total24hCents).toBe(7000);
  });

  it("recent feed is newest-first with mapped labels", () => {
    expect(d.recent[0]).toMatchObject({ kind: "bib", who: "EVE", amountCents: 2000 });
    expect(d.recent[1]).toMatchObject({ kind: "donation", who: "a donor", amountCents: 5000 });
  });

  it("ticker shows a resolved donor's name instead of 'a donor'", () => {
    const named = buildDashboard(
      buildReports({
        bibs: [
          bib({ ownerSub: "sub-obiwan", runnerCode: "bib-8q5g", nameOnBib: "OBIWAN" }),
        ],
        donations: [
          { amountCents: 3000, provider: "stripe", ownerSub: "sub-obiwan", createdAt: "2026-07-05T12:00:00Z" },
        ],
        reconciles: [],
        pendings: [],
      }),
      NOW
    );
    expect(named.recent[0]).toMatchObject({ kind: "donation", who: "OBIWAN", amountCents: 3000 });
  });

  it("carries the last bib + donation timestamps", () => {
    expect(d.lastBibTs).toBe("2026-07-05T11:00:00Z");
    expect(d.lastDonTs).toBe("2026-07-05T09:00:00Z");
  });

  it("empty money → empty series, empty feed, null timestamps, zero deltas", () => {
    const e = buildDashboard(
      buildReports({ bibs: [], donations: [], reconciles: [], pendings: [] }),
      NOW
    );
    expect(e.series).toHaveLength(0);
    expect(e.recent).toHaveLength(0);
    expect(e.lastBibTs).toBeNull();
    expect(e.total24hCents).toBe(0);
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

  it("toCsv neutralizes CSV formula-injection (prefixes leading = + - @ with ')", () => {
    // Attacker-controlled bib names must not execute as spreadsheet formulas
    // when an admin opens the export (OWASP CSV injection).
    const csv = toCsv(
      [{ key: "name", header: "name" }],
      [
        { name: "=1+1" },
        { name: "+1" },
        { name: "-2+3" },
        { name: "@SUM(A1)" },
        { name: "MTS');DROP TABLE runs;--" }, // no leading formula char → untouched
        { name: "Bucky" },
      ]
    );
    const lines = csv.split("\n");
    expect(lines[1]).toBe("'=1+1");
    expect(lines[2]).toBe("'+1");
    expect(lines[3]).toBe("'-2+3");
    expect(lines[4]).toBe("'@SUM(A1)");
    expect(lines[5]).toBe("MTS');DROP TABLE runs;--");
    expect(lines[6]).toBe("Bucky");
  });

  it("reportToCsv print-names has a header row + one line per named bib", () => {
    const csv = reportToCsv(buildReports(baseInput()), "print-names");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "name,runnerCode,paidUsd,printEligible,nameLocked,paymentTypes,email,qrUrl,QRCode1,QRCode2"
    );
    expect(lines).toHaveLength(1 + 3); // header + 3 named bibs
  });

  it("reportToCsv print-names leaves QRCode1/QRCode2 blank (spare vendor columns)", () => {
    const csv = reportToCsv(buildReports(baseInput()), "print-names");
    const lines = csv.trim().split("\n");
    // email + qrUrl are unpopulated by the pure builder too, so every data row
    // ends with the four trailing empties: email,qrUrl,QRCode1,QRCode2.
    for (const row of lines.slice(1)) {
      expect(row.endsWith(",,,")).toBe(true);
      // exactly 10 columns → 9 commas.
      expect(row.split(",")).toHaveLength(10);
    }
  });
});

describe("deny + print-names enrichment fields", () => {
  it("excludes denied pending intents from outstanding and counts them", () => {
    const bundle = buildReports({
      bibs: [],
      donations: [],
      reconciles: [],
      pendings: [
        { pendingId: "p1", ownerSub: "u1", kind: "bib", provider: "venmo", amountCents: 2000, runnerCode: "BIB-1", createdAt: "2026-07-10T00:00:00Z" },
        { pendingId: "p2", ownerSub: "u2", kind: "bib", provider: "venmo", amountCents: 2000, runnerCode: "BIB-2", createdAt: "2026-07-10T00:00:00Z", deniedAt: "2026-07-11T00:00:00Z" },
      ],
    });
    const pendingRows = bundle.outstanding.filter((r) => r.source === "pending-intent");
    expect(pendingRows.map((r) => r.pendingId)).toEqual(["p1"]);
    expect(bundle.totals.deniedCount).toBe(1);
  });

  it("carries ownerSub and a deduped joined paymentTypes on print-names rows", () => {
    const bundle = buildReports({
      bibs: [
        {
          ownerSub: "owner-9",
          runnerCode: "BIB-9",
          nameOnBib: "Dprk Runner",
          paidAmount: 4000,
          nameLocked: false,
          willPayInPerson: false,
          paidStatusHistory: [
            { provider: "cash", amount: 2000, timestamp: "2026-07-10T00:00:00Z" },
            { provider: "stripe", amount: 2000, timestamp: "2026-07-10T01:00:00Z" },
            { provider: "cash", amount: 0, timestamp: "2026-07-10T02:00:00Z" },
          ],
        } as never,
      ],
      donations: [],
      reconciles: [],
      pendings: [],
    });
    const row = bundle.printNames.find((r) => r.runnerCode === "BIB-9")!;
    expect(row.ownerSub).toBe("owner-9");
    expect(row.paymentTypes).toBe("cash+stripe");
    expect(row.email).toBeUndefined();
    expect(row.qrUrl).toBeUndefined();
  });

  it("gives an empty paymentTypes string when there is no payment history", () => {
    const bundle = buildReports({
      bibs: [
        { ownerSub: "o1", runnerCode: "BIB-0", nameOnBib: "No Pay", paidAmount: 0, nameLocked: false, willPayInPerson: true } as never,
      ],
      donations: [],
      reconciles: [],
      pendings: [],
    });
    expect(bundle.printNames[0].paymentTypes).toBe("");
  });
});

describe("reportToCsv print-names columns", () => {
  it("emits paymentTypes, email and qrUrl columns", () => {
    const bundle = buildReports({
      bibs: [
        {
          ownerSub: "o1",
          runnerCode: "BIB-1",
          nameOnBib: "Ada",
          paidAmount: 2000,
          nameLocked: false,
          willPayInPerson: false,
          paidStatusHistory: [{ provider: "stripe", amount: 2000, timestamp: "2026-07-10T00:00:00Z" }],
        } as never,
      ],
      donations: [],
      reconciles: [],
      pendings: [],
    });
    // Simulate the route's enrichment having run:
    bundle.printNames[0].email = "ada@x.com";
    bundle.printNames[0].qrUrl = "https://run.defcon.run/use1/r?h=H1";
    const csv = reportToCsv(bundle, "print-names");
    const [header, firstRow] = csv.split("\n");
    expect(header).toBe("name,runnerCode,paidUsd,printEligible,nameLocked,paymentTypes,email,qrUrl,QRCode1,QRCode2");
    expect(firstRow).toContain("stripe");
    expect(firstRow).toContain("ada@x.com");
    expect(firstRow).toContain("https://run.defcon.run/use1/r?h=H1");
    // Spare vendor columns are blank → the row ends with two empty trailing cells.
    expect(firstRow.endsWith(",,")).toBe(true);
  });
});

describe("PaymentRow reversal keys", () => {
  it("carries ownerSub + reconciledVia on bib payment rows", () => {
    const bundle = buildReports({
      bibs: [
        {
          ownerSub: "owner-x",
          runnerCode: "BIB-wbbb",
          nameOnBib: "OGRE",
          paidAmount: 2000,
          nameLocked: false,
          willPayInPerson: false,
          paidStatusHistory: [
            { provider: "cash", amount: 2000, timestamp: "2026-07-11T22:01:06.000Z", reconciled_via: "admin_inperson_cash_owner-x" },
          ],
        } as never,
      ],
      donations: [],
      reconciles: [],
      pendings: [],
    });
    const row = bundle.payments.rows.find((r) => r.provider === "cash")!;
    expect(row.ownerSub).toBe("owner-x");
    expect(row.reconciledVia).toBe("admin_inperson_cash_owner-x");
  });
});
