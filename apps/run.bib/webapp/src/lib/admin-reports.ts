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
  ownerSub: string;
  paidAmountCents: number;
  nameLocked: boolean;
  printEligible: boolean;
  // Deduped, first-seen-ordered, "+"-joined payment methods from the bib's
  // paidStatusHistory (e.g. "cash+stripe"). Empty when unpaid.
  paymentTypes: string;
  // Populated by the CSV enrichment step (admin-report-enrich); undefined in the
  // pure builder and on the live dashboard.
  email?: string;
  qrUrl?: string;
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
  // Action keys — carried on pending-intent rows so the admin ReconcileAction
  // can POST /api/admin/bib/reconcile without re-deriving them (Phase 34, D-02).
  pendingId?: string;
  ownerSub?: string;
  kind?: "bib" | "donation";
};

export type RegistrationRow = {
  nameOnBib: string;
  runnerCode: string;
  paidAmountCents: number;
  willPayInPerson: boolean;
  createdAt: string;
  // Bib PK — carried so the admin RejectAction can POST /api/admin/bib/reject.
  // Safe to expose on the admin-only roster (Phase 34, D-04).
  ownerSub?: string;
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
  // Denied pending intents (soft-deleted fakes) — surfaced so they are counted,
  // not silently vanished.
  deniedCount: number;
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
  // Narrowed to the PendingKind union (matches OutstandingRow.kind). loadReports()
  // feeds real PendingContributionItem rows whose kind is already this union.
  kind?: "bib" | "donation";
  provider?: string;
  amountCents?: number;
  runnerCode?: string;
  createdAt?: string;
  pendingId?: string;
  ownerSub?: string;
  // Soft-deny marker — denied intents are excluded from Outstanding (Kurt 2026-07-11).
  deniedAt?: string;
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
 * Registration predicate (Phase 34, D-01 / Kurt 2026-07-04): a bib counts as a
 * real registration only when it carries a name, a payment, OR an in-person
 * pledge. Bibs are auto-created on first visit, so an untouched visit leaves a
 * phantom empty row — these are filtered from admin totals + roster (SC34.1)
 * while the underlying auto-create-on-visit behaviour is unchanged.
 */
export function isRegistered(b: BibItem): boolean {
  return (
    (b.nameOnBib?.trim().length ?? 0) > 0 ||
    (b.paidAmount ?? 0) > 0 ||
    b.willPayInPerson === true
  );
}

/**
 * Pure report shaping. Given already-fetched rows, compute all four reports
 * plus totals. Deterministic + AWS-free for unit testing.
 */
export function buildReports(input: ReportInput): ReportBundle {
  const { bibs, donations, reconciles, pendings } = input;

  // Registered bibs only — phantom empty visit-created rows are excluded from
  // totals.bibs and the registrations roster (SC34.1). The full `bibs` list is
  // still used for print-names, payments, in-person pledges, and $ collected —
  // those intentionally read every bib.
  const registered = bibs.filter(isRegistered);

  // 1. Print-name list — every named bib, flagged print-eligible.
  const printNames: PrintNameRow[] = bibs
    .filter((b) => (b.nameOnBib ?? "").trim().length > 0)
    .map((b) => {
      const paid = b.paidAmount ?? 0;
      const locked = b.nameLocked === true;
      // In-person pledgers (Kurt 2026-07-05): treated as print-eligible and shown
      // at the $20 bib price even before the cash lands — they promised to pay in
      // person, so the printer should include them. This is a print-list display +
      // eligibility rule only; it does NOT touch bibCollectedCents / grand totals,
      // which stay based on real reconciled money.
      const pledgedInPerson = b.willPayInPerson === true && paid === 0;
      const effectivePaidCents = pledgedInPerson ? PRINT_GATE_CENTS : paid;
      const providers: string[] = [];
      for (const p of (b.paidStatusHistory ?? []) as Array<{ provider?: string }>) {
        const prov = (p.provider ?? "").trim();
        if (prov && !providers.includes(prov)) providers.push(prov);
      }
      return {
        nameOnBib: b.nameOnBib ?? "",
        runnerCode: b.runnerCode,
        ownerSub: b.ownerSub,
        paidAmountCents: effectivePaidCents,
        nameLocked: locked,
        // Eligible at the $20 bib-spend gate OR an in-person pledge.
        printEligible: effectivePaidCents >= PRINT_GATE_CENTS,
        paymentTypes: providers.join("+"),
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
      // Show the pledged $20 (Kurt 2026-07-05) rather than a dash — it's the
      // amount they've committed to pay at the event, not $0. Still "pledged"
      // (unreconciled), so it doesn't count as collected money in the totals.
      amountCents: PRINT_GATE_CENTS,
      status: "pledged",
      detail: "Pledge to pay in person.",
      // Carried so the admin "PAID" action can book the $20 against this bib
      // (Kurt 2026-07-05) — clicking it reconciles the pledge into real revenue.
      ownerSub: b.ownerSub,
    }));
  const activePendings = pendings.filter((p) => !p.deniedAt);
  const deniedCount = pendings.length - activePendings.length;
  const pendingRows: OutstandingRow[] = activePendings.map((p) => ({
    source: "pending-intent" as const,
    runnerCode: p.runnerCode ?? "—",
    nameOnBib: bibByRunner.get(p.runnerCode ?? "")?.nameOnBib ?? "",
    provider: p.provider ?? "",
    amountCents: p.amountCents ?? 0,
    status: "awaiting-reconcile",
    detail: `${p.kind ?? "intent"} tapped ${(p.createdAt ?? "").slice(0, 19)}`,
    // Action keys for the admin ReconcileAction (Phase 34, D-02).
    pendingId: p.pendingId,
    ownerSub: p.ownerSub,
    kind: p.kind,
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

  // 4. All registrations — master roster (registered bibs only; SC34.1).
  const registrations: RegistrationRow[] = registered
    .map((b) => ({
      nameOnBib: b.nameOnBib ?? "",
      runnerCode: b.runnerCode,
      paidAmountCents: b.paidAmount ?? 0,
      willPayInPerson: b.willPayInPerson === true,
      createdAt: b.createdAt ?? "",
      // Bib PK for the admin RejectAction (Phase 34, D-04).
      ownerSub: b.ownerSub,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Totals.
  const bibCollectedCents = bibs.reduce((s, b) => s + (b.paidAmount ?? 0), 0);
  const donationCents = donations.reduce((s, d) => s + (d.amountCents ?? 0), 0);
  const totals: ReportTotals = {
    // Count only registered bibs — phantom empty rows are excluded (SC34.1).
    bibs: registered.length,
    inPersonPledges: bibs.filter((b) => b.willPayInPerson === true).length,
    bibCollectedCents,
    donationCount: donations.length,
    donationCents,
    grandTotalCents: bibCollectedCents + donationCents,
    pendingCount: pendingRows.length + reconcileRows.length,
    printEligible: printNames.filter((r) => r.printEligible).length,
    deniedCount,
  };

  return {
    printNames,
    payments: { rows: paymentRows, totalCents: paymentsTotal, byProvider },
    outstanding,
    registrations,
    totals,
  };
}

/* ============================================================================
   Dashboard view-model (Kurt 2026-07-05 "Live Ops" redesign).

   Derives the fancy top-of-page widgets — hero sparklines, the cumulative
   revenue chart, the 24h trend deltas, and the live event ticker — from the
   SAME real, reconciled money in the report bundle. Cumulative revenue only
   ever increases, so the "always up" trend is honest, not simulated. When
   there's no money yet, the series is empty and the UI shows a calm empty
   state rather than faking numbers.
   ============================================================================ */

export type DashPoint = {
  /** ISO timestamp of this payment (the x value). */
  t: string;
  /** Running cumulative totals AT this point, in cents. */
  bibCents: number;
  donCents: number;
  totalCents: number;
};

export type DashEvent = {
  kind: "bib" | "donation";
  /** Display name — bib name, or "a donor" for anonymous donations. */
  who: string;
  amountCents: number;
  provider: string;
  ts: string;
};

export type DashboardView = {
  /** Cumulative money over time, oldest→newest. Empty when nothing reconciled. */
  series: DashPoint[];
  /** Reconciled in the last 24h (cents) — the green ▲ delta on each hero. */
  bib24hCents: number;
  don24hCents: number;
  total24hCents: number;
  /** Most-recent money events first (capped) — feeds the live ticker. */
  recent: DashEvent[];
  /** Most recent bib / donation payment timestamps, or null. */
  lastBibTs: string | null;
  lastDonTs: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TICKER_MAX = 14;

/**
 * Pure dashboard shaping from an already-built {@link ReportBundle}. `nowMs`
 * is injected (not read from the clock) so the 24h window is deterministic and
 * unit-testable. Reads only `bundle.payments.rows` — real reconciled money.
 */
export function buildDashboard(
  bundle: ReportBundle,
  nowMs: number
): DashboardView {
  // Oldest→newest so the cumulative walk is monotonic.
  const asc = [...bundle.payments.rows]
    .filter((r) => r.timestamp)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  const series: DashPoint[] = [];
  let bibC = 0;
  let donC = 0;
  for (const r of asc) {
    if (r.kind === "bib") bibC += r.amountCents;
    else donC += r.amountCents;
    series.push({ t: r.timestamp, bibCents: bibC, donCents: donC, totalCents: bibC + donC });
  }

  const cutoff = nowMs - DAY_MS;
  const within = (ts: string) => {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) && ms >= cutoff;
  };
  let bib24 = 0;
  let don24 = 0;
  for (const r of asc) {
    if (!within(r.timestamp)) continue;
    if (r.kind === "bib") bib24 += r.amountCents;
    else don24 += r.amountCents;
  }

  const recent: DashEvent[] = [...asc]
    .reverse()
    .slice(0, TICKER_MAX)
    .map((r) => ({
      kind: r.kind,
      who:
        r.kind === "donation"
          ? "a donor"
          : (r.nameOnBib || "").trim() || r.runnerCode || "a runner",
      amountCents: r.amountCents,
      provider: r.provider,
      ts: r.timestamp,
    }));

  const lastOf = (kind: "bib" | "donation"): string | null => {
    for (let i = asc.length - 1; i >= 0; i--) if (asc[i].kind === kind) return asc[i].timestamp;
    return null;
  };

  return {
    series,
    bib24hCents: bib24,
    don24hCents: don24,
    total24hCents: bib24 + don24,
    recent,
    lastBibTs: lastOf("bib"),
    lastDonTs: lastOf("donation"),
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

/**
 * Escape one CSV cell.
 *  1. Formula-injection guard (OWASP): a cell that BEGINS with = + - @ or a
 *     tab/CR is evaluated as a formula by Excel / Google Sheets / LibreOffice
 *     when the file is opened — enabling exfiltration (=HYPERLINK/=WEBSERVICE)
 *     or command execution (=cmd|'/c …'!A1). Bib names are attacker-controlled
 *     (runners type them), so we neutralize by prefixing a single quote.
 *  2. RFC-4180 quoting: wrap + double-quote when the value contains ", \n or ".
 */
function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
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
          { key: "paymentTypes", header: "paymentTypes" },
          { key: "email", header: "email" },
          { key: "qrUrl", header: "qrUrl" },
        ],
        bundle.printNames.map((r) => ({
          ...r,
          paid: dollars(r.paidAmountCents),
          email: r.email ?? "",
          qrUrl: r.qrUrl ?? "",
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
