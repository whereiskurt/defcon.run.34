import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import { requireAdmin } from "@/lib/admin-gate";
import {
  loadReports,
  formatUsd,
  type ReportBundle,
} from "@/lib/admin-reports";

/**
 * /admin — v1.6 gated admin reporting dashboard (Kurt 2026-07-03).
 *
 * Server component. Gated on the "admin" group claim (requireAdmin). Reads
 * the report bundle in-process (same DynamoDB scans as the CSV endpoints)
 * and renders four tables — print-name list, payments/revenue, outstanding +
 * in-person, all registrations — each with a CSV download link.
 *
 * Styling is intentionally plain dark-theme inline (matches the current bib
 * app); it will be re-skinned to the HeroUI/Vegas design system in Phase A.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Base path for the CSV API links. In production the app is mounted at
 * `/{region}` (basePath); a plain <a href> is NOT auto-prefixed, so mirror
 * run.human's getApiBasePath() and prepend it. Dev has no basePath.
 */
function apiBase(): string {
  return process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";
}

export default async function AdminPage() {
  const session = await auth();
  const gate = requireAdmin(session);

  if (!gate.ok && gate.reason === "no_session") {
    redirect("/signin");
  }
  if (!gate.ok) {
    return <Forbidden />;
  }

  const bundle = await loadReports();
  const base = apiBase();

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#e4e4ef",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "48px 20px 96px",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ fontSize: 30, margin: 0, fontWeight: 800 }}>
            run.defcon.run 34 · Bib Admin
          </h1>
          <p style={{ margin: 0, color: "#a4a4b8", fontSize: 14 }}>
            Live reports over the bib data. Signed in as{" "}
            {gate.email ?? "admin"}.
          </p>
        </header>

        <TotalsStrip totals={bundle.totals} />

        <ReportSection
          title="Print-name list"
          note="Every named bib, print-eligible first (paid ≥ $20 on a bib). This is the printer handoff."
          csvHref={`${base}/api/admin/bib/report/print-names`}
        >
          <Table
            columns={["Name", "Runner code", "Paid", "Eligible", "Locked"]}
            rows={bundle.printNames.map((r) => [
              r.nameOnBib,
              r.runnerCode,
              formatUsd(r.paidAmountCents),
              r.printEligible ? "✓" : "",
              r.nameLocked ? "✓" : "",
            ])}
            empty="No named bibs yet."
          />
        </ReportSection>

        <ReportSection
          title="Payments / revenue"
          note={`Reconciled money. Grand total ${formatUsd(
            bundle.payments.totalCents
          )} · ${Object.entries(bundle.payments.byProvider)
            .map(([p, c]) => `${p} ${formatUsd(c)}`)
            .join(" · ") || "no payments yet"}.`}
          csvHref={`${base}/api/admin/bib/report/payments`}
        >
          <Table
            columns={["When", "Kind", "Runner code", "Name", "Provider", "Amount"]}
            rows={bundle.payments.rows.map((r) => [
              (r.timestamp || "").slice(0, 19),
              r.kind,
              r.runnerCode,
              r.nameOnBib,
              r.provider,
              formatUsd(r.amountCents),
            ])}
            empty="No reconciled payments yet."
          />
        </ReportSection>

        <ReportSection
          title="Outstanding + in-person"
          note="Pledged-to-pay-in-person + unreconciled Venmo/Cash App intents needing a manual match."
          csvHref={`${base}/api/admin/bib/report/outstanding`}
        >
          <Table
            columns={["Source", "Status", "Runner code", "Name", "Provider", "Amount", "Detail"]}
            rows={bundle.outstanding.map((r) => [
              r.source,
              r.status,
              r.runnerCode,
              r.nameOnBib,
              r.provider,
              r.amountCents ? formatUsd(r.amountCents) : "—",
              r.detail,
            ])}
            empty="Nothing outstanding."
          />
        </ReportSection>

        <ReportSection
          title="All registrations"
          note="Master roster — every bib regardless of pay state."
          csvHref={`${base}/api/admin/bib/report/registrations`}
        >
          <Table
            columns={["Name", "Runner code", "Paid", "In person", "Created"]}
            rows={bundle.registrations.map((r) => [
              r.nameOnBib || "—",
              r.runnerCode,
              formatUsd(r.paidAmountCents),
              r.willPayInPerson ? "✓" : "",
              (r.createdAt || "").slice(0, 19),
            ])}
            empty="No registrations yet."
          />
        </ReportSection>
      </div>
    </main>
  );
}

function TotalsStrip({ totals }: { totals: ReportBundle["totals"] }) {
  const cards: [string, string][] = [
    ["Bibs", String(totals.bibs)],
    ["Print-eligible", String(totals.printEligible)],
    ["In-person pledges", String(totals.inPersonPledges)],
    ["Bib $ collected", formatUsd(totals.bibCollectedCents)],
    ["Donations", `${totals.donationCount} · ${formatUsd(totals.donationCents)}`],
    ["Grand total", formatUsd(totals.grandTotalCents)],
    ["Pending reconcile", String(totals.pendingCount)],
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 12,
      }}
    >
      {cards.map(([label, value]) => (
        <div
          key={label}
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            backgroundColor: "#12121a",
            border: "1px solid #24242e",
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#8f8fa8",
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#6CCDB8" }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportSection({
  title,
  note,
  csvHref,
  children,
}: {
  title: string;
  note: string;
  csvHref: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 20,
        borderRadius: 14,
        backgroundColor: "#12121a",
        border: "1px solid #24242e",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>{title}</h2>
        <a
          href={csvHref}
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#0a0a0a",
            backgroundColor: "#6CCDB8",
            padding: "6px 14px",
            borderRadius: 6,
            textDecoration: "none",
          }}
        >
          Download CSV
        </a>
      </div>
      <p style={{ margin: 0, color: "#a4a4b8", fontSize: 13, lineHeight: 1.5 }}>
        {note}
      </p>
      {children}
    </section>
  );
}

function Table({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: string[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ margin: "4px 0", color: "#6a6a7a", fontSize: 14 }}>{empty}</p>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderBottom: "1px solid #2a2a34",
                  color: "#8f8fa8",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: "7px 10px",
                    borderBottom: "1px solid #1c1c26",
                    color: "#d4d4e4",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Forbidden() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0a0a0a",
        color: "#e4e4ef",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Admin access required</h1>
        <p style={{ color: "#a4a4b8", fontSize: 15, lineHeight: 1.6 }}>
          Your account is not in the <code>admin</code> group. Ask an organizer
          to grant access, then sign out and back in.
        </p>
      </div>
    </main>
  );
}
