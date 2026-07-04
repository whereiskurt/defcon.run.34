/**
 * admin-reports — v1.6 (Kurt 2026-07-03).
 *
 * Aggregations behind the gated /admin dashboard + CSV endpoints. Ports the
 * logic from `apps/run.bib/scripts/bib-report.sh` into typed, testable
 * functions. `buildReports()` is pure (takes already-scanned rows) so vitest
 * can pin the shaping without AWS; `loadReports()` does the DynamoDB scans.
 *
 * Scale: full-table scans, O(n). Bounded at DEF CON 34 attendance (single
 * thousands of bibs) — fine at v1.6. A GSI is a v1.7+ option if it bites.
 *
 * Money is in integer cents everywhere; format at the edge with formatUsd().
 */

import { Bib, type BibItem } from "@/entities/bib";
import { GeneralDonation } from "@/entities/general-donation";
import { BibReconcile } from "@/entities/bib-reconcile";
import { PendingContribution } from "@/entities/pending-contribution";

/**
 * The physical-bib print gate (Kurt 2026-07-03): a name prints iff the runner
 * has paid ≥ $20 on a bib product AND entered a name. Mirrors the entity
 * helper `canPrintName()` / `PRINT_PAID_MIN_CENTS`. The print-name report is
 * already filtered to named bibs, so `printEligible` here is the $20 spend.
 */
export const PRINT_GATE_CENTS = 2000;

export type ReportType =
  | "print-names"
  | "payments"
  | "outstanding"
  | "registrations";

export type PrintNameRow = {
  nameOnBib: string;
  runnerCode: string;
  paidAmountCents: number;
  nameLocked: boolean;
  printEligible: boolean;
};

export type PaymentRow = {
  kind: "bib" | "donation";
  runnerCode: string;
  nameOnBib: string;
  provider: string;
  amountCents: number;
  timestamp: string;
};

export type OutstandingRow = {
  source: "in-person" | "pending-intent" | "reconcile";
  runnerCode: string;
  nameOnBib: string;
  provider: string;
  amountCents: number;
  status: string;
  detail: string;
};

export type RegistrationRow = {
  nameOnBib: string;
  runnerCode: string;
  paidAmountCents: number;
  willPayInPerson: boolean;
  createdAt: string;
};

export type ReportTotals = {
  bibs: number;
  inPersonPledges: number;
  bibCollectedCents: number;
  donationCount: number;
  donationCents: number;
  grandTotalCents: number;
  pendingCount: number;
  printEligible: number;
};

export type ReportBundle = {
  printNames: PrintNameRow[];
  payments: {
    rows: PaymentRow[];
    totalCents: number;
    byProvider: Record<string, number>;
  };
  outstanding: OutstandingRow[];
  registrations: RegistrationRow[];
  totals: ReportTotals;
};

/** Minimal row shapes the builder consumes (subset of each entity item). */
type DonationLike = {
  amountCents?: number;
  provider?: string;
  ownerSub?: string | null;
  createdAt?: string;
};
type ReconcileLike = {
  status?: string;
  provider?: string;
  extractedAmount?: number;
  extractedSenderName?: string;
  receiptId?: string;
  createdAt?: string;
};
type PendingLike = {
  kind?: string;
  provider?: string;
  amountCents?: number;
  runnerCode?: string;
  createdAt?: string;
};

export type ReportInput = {
  bibs: BibItem[];
  donations: DonationLike[];
  reconciles: ReconcileLike[];
  pendings: PendingLike[];
};

const byTimestampDesc = (a: { timestamp: string }, b: { timestamp: string }) =>
  a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0;

/**
 * Pure report shaping. Given already-fetched rows, compute all four reports
 * plus totals. Deterministic + AWS-free for unit testing.
 */
export function buildReports(input: ReportInput): ReportBundle {
  const { bibs, donations, reconciles, pendings } = input;

  // 1. Print-name list — every named bib, flagged print-eligible.
  const printNames: PrintNameRow[] = bibs
    .filter((b) => (b.nameOnBib ?? "").trim().length > 0)
    .map((b) => {
      const paid = b.paidAmount ?? 0;
      const locked = b.nameLocked === true;
      return {
        nameOnBib: b.nameOnBib ?? "",
        runnerCode: b.runnerCode,
        paidAmountCents: paid,
        nameLocked: locked,
        // Named bibs only reach here; eligibility is the $20 bib-spend gate.
        printEligible: paid >= PRINT_GATE_CENTS,
      };
    })
    // Eligible first, then by amount desc, then name.
    .sort(
      (a, b) =>
        Number(b.printEligible) - Number(a.printEligible) ||
        b.paidAmountCents - a.paidAmountCents ||
        a.nameOnBib.localeCompare(b.nameOnBib)
    );

  // 2. Payments / revenue — reconciled bib payments + donations.
  const bibByRunner = new Map(bibs.map((b) => [b.runnerCode, b]));
  const bibPayments: PaymentRow[] = bibs.flatMap((b) =>
    ((b.paidStatusHistory ?? []) as Array<{
      provider?: string;
      amount?: number;
      timestamp?: string;
    }>).map((p) => ({
      kind: "bib" as const,
      runnerCode: b.runnerCode,
      nameOnBib: b.nameOnBib ?? "",
      provider: p.provider ?? "stripe",
      amountCents: p.amount ?? 0,
      timestamp: p.timestamp ?? "",
    }))
  );
  const donationPayments: PaymentRow[] = donations.map((d) => ({
    kind: "donation" as const,
    runnerCode: "—",
    nameOnBib: "(donation)",
    provider: d.provider ?? "stripe",
    amountCents: d.amountCents ?? 0,
    timestamp: d.createdAt ?? "",
  }));
  const paymentRows = [...bibPayments, ...donationPayments].sort(byTimestampDesc);
  const byProvider: Record<string, number> = {};
  let paymentsTotal = 0;
  for (const r of paymentRows) {
    paymentsTotal += r.amountCents;
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + r.amountCents;
  }

  // 3. Outstanding + in-person — pledged-unpaid + unreconciled intents.
  const inPerson: OutstandingRow[] = bibs
    .filter((b) => b.willPayInPerson === true && (b.paidAmount ?? 0) === 0)
    .map((b) => ({
      source: "in-person" as const,
      runnerCode: b.runnerCode,
      nameOnBib: b.nameOnBib ?? "",
      provider: "in-person",
      amountCents: 0,
      status: "pledged",
      detail: "Registered + pledged to pay in person; nothing reconciled yet.",
    }));
  const pendingRows: OutstandingRow[] = pendings.map((p) => ({
    source: "pending-intent" as const,
    runnerCode: p.runnerCode ?? "—",
    nameOnBib: bibByRunner.get(p.runnerCode ?? "")?.nameOnBib ?? "",
    provider: p.provider ?? "",
    amountCents: p.amountCents ?? 0,
    status: "awaiting-reconcile",
    detail: `${p.kind ?? "intent"} tapped ${(p.createdAt ?? "").slice(0, 19)}`,
  }));
  const reconcileRows: OutstandingRow[] = reconciles
    .filter((r) => r.status && r.status !== "matched")
    .map((r) => ({
      source: "reconcile" as const,
      runnerCode: "—",
      nameOnBib: r.extractedSenderName ?? "",
      provider: r.provider ?? "",
      amountCents: r.extractedAmount ?? 0,
      status: r.status ?? "unmatched",
      detail: `receipt ${(r.receiptId ?? "").slice(0, 24)}`,
    }));
  const outstanding = [...inPerson, ...pendingRows, ...reconcileRows];

  // 4. All registrations — master roster.
  const registrations: RegistrationRow[] = bibs
    .map((b) => ({
      nameOnBib: b.nameOnBib ?? "",
      runnerCode: b.runnerCode,
      paidAmountCents: b.paidAmount ?? 0,
      willPayInPerson: b.willPayInPerson === true,
      createdAt: b.createdAt ?? "",
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Totals.
  const bibCollectedCents = bibs.reduce((s, b) => s + (b.paidAmount ?? 0), 0);
  const donationCents = donations.reduce((s, d) => s + (d.amountCents ?? 0), 0);
  const totals: ReportTotals = {
    bibs: bibs.length,
    inPersonPledges: bibs.filter((b) => b.willPayInPerson === true).length,
    bibCollectedCents,
    donationCount: donations.length,
    donationCents,
    grandTotalCents: bibCollectedCents + donationCents,
    pendingCount: pendingRows.length + reconcileRows.length,
    printEligible: printNames.filter((r) => r.printEligible).length,
  };

  return {
    printNames,
    payments: { rows: paymentRows, totalCents: paymentsTotal, byProvider },
    outstanding,
    registrations,
    totals,
  };
}

/** Scan the electro table for all report entities and build the bundle. */
export async function loadReports(): Promise<ReportBundle> {
  const [bibs, donations, reconciles, pendings] = await Promise.all([
    Bib.scan.go({ pages: "all" }).then((r) => r.data),
    GeneralDonation.scan.go({ pages: "all" }).then((r) => r.data),
    BibReconcile.scan.go({ pages: "all" }).then((r) => r.data),
    PendingContribution.scan.go({ pages: "all" }).then((r) => r.data),
  ]);
  return buildReports({ bibs, donations, reconciles, pendings });
}

/** cents → `$1,234.56`. */
export function formatUsd(cents: number): string {
  return `$${((cents ?? 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Escape one CSV cell (RFC-4180: quote when it contains ",\n or "). */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize labelled columns + rows to a CSV string. */
export function toCsv(
  columns: { key: string; header: string }[],
  rows: Record<string, unknown>[]
): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => csvCell(row[c.key])).join(",")
  );
  return [head, ...body].join("\n");
}

/** Render a single report type to CSV (dollar amounts as plain numbers). */
export function reportToCsv(bundle: ReportBundle, type: ReportType): string {
  const dollars = (cents: number) => (cents / 100).toFixed(2);
  switch (type) {
    case "print-names":
      return toCsv(
        [
          { key: "nameOnBib", header: "name" },
          { key: "runnerCode", header: "runnerCode" },
          { key: "paid", header: "paidUsd" },
          { key: "printEligible", header: "printEligible" },
          { key: "nameLocked", header: "nameLocked" },
        ],
        bundle.printNames.map((r) => ({
          ...r,
          paid: dollars(r.paidAmountCents),
        }))
      );
    case "payments":
      return toCsv(
        [
          { key: "nameOnBib", header: "name" },
          { key: "runnerCode", header: "runnerCode" },
          { key: "timestamp", header: "timestamp" },
          { key: "kind", header: "kind" },
          { key: "provider", header: "provider" },
          { key: "amount", header: "amountUsd" },
        ],
        bundle.payments.rows.map((r) => ({
          ...r,
          amount: dollars(r.amountCents),
        }))
      );
    case "outstanding":
      return toCsv(
        [
          { key: "nameOnBib", header: "name" },
          { key: "runnerCode", header: "runnerCode" },
          { key: "source", header: "source" },
          { key: "status", header: "status" },
          { key: "provider", header: "provider" },
          { key: "amount", header: "amountUsd" },
          { key: "detail", header: "detail" },
        ],
        bundle.outstanding.map((r) => ({
          ...r,
          amount: dollars(r.amountCents),
        }))
      );
    case "registrations":
      return toCsv(
        [
          { key: "nameOnBib", header: "name" },
          { key: "runnerCode", header: "runnerCode" },
          { key: "paid", header: "paidUsd" },
          { key: "willPayInPerson", header: "willPayInPerson" },
          { key: "createdAt", header: "createdAt" },
        ],
        bundle.registrations.map((r) => ({
          ...r,
          paid: dollars(r.paidAmountCents),
        }))
      );
  }
}
