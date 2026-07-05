import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import { requireAdmin } from "@/lib/admin-gate";
import {
  loadReports,
  buildDashboard,
  formatUsd,
  type ReportBundle,
  type DashboardView,
  type DashPoint,
  type DashEvent,
} from "@/lib/admin-reports";
import {
  ReconcileAction,
  RejectAction,
  MarkPaidAction,
} from "@/components/AdminActions";

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
  // Live-ops view-model (hero sparklines, revenue chart, 24h trends, ticker) —
  // derived from the same reconciled money. Date.now() is fine: force-dynamic.
  const now = Date.now();
  const dash = buildDashboard(bundle, now);

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#e4e4ef",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "40px 20px 96px",
      }}
    >
      <div
        className="adash"
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ fontSize: 28, margin: 0, fontWeight: 800 }}>
              defcon<span style={{ color: "#6CCDB8" }}>.</span>run 34 · Bib Admin
            </h1>
            <p style={{ margin: 0, color: "#8f8fa8", fontSize: 14 }}>
              Live reports over the bib data · signed in as {gate.email ?? "admin"}.
            </p>
          </div>
          <span className="adash-live">
            <span className="adash-pip" />
            live
          </span>
        </header>

        <DashboardHeader dash={dash} totals={bundle.totals} now={now} />

        <ReportSection
          title="Print-name list"
          note="Every named bib, print-eligible first (paid ≥ $20 on a bib). This is the printer handoff."
          csvHref={`${base}/api/admin/bib/report/print-names`}
        >
          <Table
            columns={["Name", "Runner code", "Paid", "Status"]}
            rows={bundle.printNames.map((r) => [
              r.nameOnBib,
              r.runnerCode,
              formatUsd(r.paidAmountCents),
              <span key="s" style={{ display: "inline-flex", gap: 6 }}>
                <span
                  className={`adash-pill ${r.printEligible ? "ok" : "mut"}`}
                >
                  {r.printEligible ? "eligible" : "under $20"}
                </span>
                {r.nameLocked && <span className="adash-pill warn">🔒 locked</span>}
              </span>,
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
            columns={["Name", "Runner code", "When", "Kind", "Provider", "Amount"]}
            rows={bundle.payments.rows.map((r) => [
              r.nameOnBib,
              r.runnerCode,
              (r.timestamp || "").slice(0, 19),
              r.kind,
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
            columns={["Action", "Name", "Runner code", "Source", "Status", "Provider", "Amount", "Detail"]}
            rows={bundle.outstanding.map((r) => [
              r.source === "pending-intent" && r.pendingId && r.ownerSub && r.kind ? (
                <ReconcileAction
                  apiBase={base}
                  pendingId={r.pendingId}
                  ownerSub={r.ownerSub}
                  kind={r.kind}
                  provider={r.provider as "venmo" | "cashapp"}
                  amountCents={r.amountCents}
                />
              ) : r.source === "in-person" && r.ownerSub ? (
                // Runner paid their pledged $20 cash at the event → book it.
                <MarkPaidAction
                  apiBase={base}
                  ownerSub={r.ownerSub}
                  amountCents={r.amountCents}
                />
              ) : (
                ""
              ),
              r.nameOnBib,
              r.runnerCode,
              r.source,
              r.status,
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
            columns={["Action", "Name", "Runner code", "Paid", "In person", "Created"]}
            rows={bundle.registrations.map((r) => [
              r.ownerSub ? (
                <RejectAction apiBase={base} ownerSub={r.ownerSub} />
              ) : (
                ""
              ),
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

/* ============================================================================
   Live-ops dashboard header (Kurt 2026-07-05 redesign) — hero stat cards with
   real cumulative sparklines, a chip strip, a cumulative revenue chart, and a
   live event ticker. All server-rendered from real reconciled money; the chart
   only animates via CSS (the ticker marquee). Empty states are honest — no
   faked numbers.
   ============================================================================ */

function moneyParts(cents: number): { whole: string; cents: string } {
  const v = (Math.round(cents) / 100).toFixed(2).split(".");
  return { whole: Number(v[0]).toLocaleString("en-US"), cents: v[1] };
}

function ago(ts: string | null, now: number): string {
  if (!ts) return "—";
  const diff = now - Date.parse(ts);
  if (!Number.isFinite(diff)) return "—";
  if (diff < 60000) return "just now";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const dashPanelStyle: React.CSSProperties = {
  border: "1px solid #24242e",
  borderRadius: 16,
  backgroundColor: "#12121a",
  overflow: "hidden",
};

function DashboardHeader({
  dash,
  totals,
  now,
}: {
  dash: DashboardView;
  totals: ReportBundle["totals"];
  now: number;
}) {
  return (
    <>
      <div className="adash-heroes">
        <Hero
          kind="bib"
          label="Bib $ collected"
          cents={totals.bibCollectedCents}
          delta={dash.bib24hCents}
          series={dash.series}
          field="bibCents"
          color="#6CCDB8"
          sub={
            dash.lastBibTs ? (
              <>
                last bib · <b>{ago(dash.lastBibTs, now)}</b>
              </>
            ) : (
              <>no bibs paid yet</>
            )
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="4" y="5" width="16" height="14" rx="2" />
              <path d="M4 10h16" />
            </svg>
          }
        />
        <Hero
          kind="don"
          label="Donation $"
          cents={totals.donationCents}
          delta={dash.don24hCents}
          series={dash.series}
          field="donCents"
          color="#F5C451"
          sub={
            dash.lastDonTs ? (
              <>
                last donation · <b>{ago(dash.lastDonTs, now)}</b>
              </>
            ) : (
              <>no donations yet</>
            )
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v8" />
            </svg>
          }
        />
        <Hero
          kind="tot"
          label="Grand total"
          cents={totals.grandTotalCents}
          delta={dash.total24hCents}
          series={dash.series}
          field="totalCents"
          color="#e7e7f2"
          sub={
            <>
              <b>{totals.bibs}</b> registrations
            </>
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M3 3v18h18" />
              <path d="M7 15l3-4 3 2 4-6" />
            </svg>
          }
        />
      </div>

      <div className="adash-chips">
        <Chip k="Bibs" v={totals.bibs} />
        <Chip k="Print-eligible" v={totals.printEligible} />
        <Chip k="In-person pledges" v={totals.inPersonPledges} />
        <Chip k="Donations" v={totals.donationCount} />
        <Chip
          k="Pending reconcile"
          v={totals.pendingCount}
          attn={totals.pendingCount > 0}
        />
      </div>

      <RevenuePanel dash={dash} now={now} />
    </>
  );
}

function Chip({ k, v, attn }: { k: string; v: number; attn?: boolean }) {
  return (
    <span className={`adash-chip${attn ? " attn" : ""}`}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </span>
  );
}

function Trend({ cents }: { cents: number }) {
  if (cents <= 0) {
    return <span className="adash-trend flat">quiet · 24h</span>;
  }
  const m = moneyParts(cents);
  return (
    <span className="adash-trend">
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M2 8l3-3 2 2 3-4" />
        <path d="M8 3h2v2" />
      </svg>
      ${m.whole} · 24h
    </span>
  );
}

function Hero({
  kind,
  label,
  cents,
  delta,
  series,
  field,
  color,
  sub,
  icon,
}: {
  kind: "bib" | "don" | "tot";
  label: string;
  cents: number;
  delta: number;
  series: DashPoint[];
  field: "bibCents" | "donCents" | "totalCents";
  color: string;
  sub: React.ReactNode;
  icon: React.ReactNode;
}) {
  const m = moneyParts(cents);
  return (
    <div className={`adash-hero ${kind}`}>
      <div className="adash-eyebrow">
        {icon}
        {label}
      </div>
      <div className="adash-val">
        ${m.whole}
        <span className="cent">.{m.cents}</span>
      </div>
      <Sparkline series={series} field={field} color={color} />
      <div className="adash-row">
        <Trend cents={delta} />
        <span className="adash-lastev">{sub}</span>
      </div>
    </div>
  );
}

function Sparkline({
  series,
  field,
  color,
}: {
  series: DashPoint[];
  field: "bibCents" | "donCents" | "totalCents";
  color: string;
}) {
  const W = 300;
  const H = 34;
  const pad = 3;
  const vals = series.map((p) => p[field]);
  if (vals.length < 2) {
    return (
      <svg
        className="adash-spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1={pad}
          y1={H - pad}
          x2={W - pad}
          y2={H - pad}
          stroke={color}
          strokeOpacity={0.3}
          strokeWidth={2}
          strokeDasharray="3 5"
        />
      </svg>
    );
  }
  const max = Math.max(...vals, 1);
  const n = vals.length;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (n - 1)) * (W - pad * 2);
    const y = H - pad - (v / max) * (H - pad * 2);
    return [x, y] as [number, number];
  });
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const end = pts[pts.length - 1];
  const area = `${line} L${(W - pad).toFixed(1)} ${(H - pad).toFixed(1)} L${pad} ${(
    H - pad
  ).toFixed(1)} Z`;
  const gid = `sp-${field}`;
  return (
    <svg
      className="adash-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.28} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={end[0].toFixed(1)} cy={end[1].toFixed(1)} r={2.6} fill={color} />
    </svg>
  );
}

function RevenuePanel({ dash, now }: { dash: DashboardView; now: number }) {
  const hasData = dash.series.length >= 2;
  return (
    <div style={dashPanelStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
          padding: "18px 20px 4px",
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, margin: 0, fontWeight: 700 }}>
            Cumulative revenue
          </h2>
          <div style={{ fontSize: 12.5, color: "#8f8fa8" }}>
            Reconciled money over time — it only goes up.
          </div>
        </div>
        <div className="adash-legend">
          <span>
            <span className="sw" style={{ background: "#6CCDB8" }} />
            Bibs
          </span>
          <span>
            <span className="sw" style={{ background: "#F5C451" }} />
            Donations
          </span>
        </div>
      </div>
      <div style={{ padding: "6px 10px 0" }}>
        {hasData ? (
          <RevenueChart series={dash.series} />
        ) : (
          <div className="adash-empty">
            The revenue chart starts with your first reconciled payment.
          </div>
        )}
      </div>
      <Ticker events={dash.recent} now={now} />
    </div>
  );
}

function RevenueChart({ series }: { series: DashPoint[] }) {
  const W = 900;
  const H = 210;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 10;
  const totVals = series.map((p) => p.totalCents);
  const bibVals = series.map((p) => p.bibCents);
  const max = Math.max(...totVals, 1) * 1.04;
  const n = series.length;
  const mapPts = (vals: number[]) =>
    vals.map((v, i) => {
      const x = padL + (i / (n - 1)) * (W - padL - padR);
      const y = H - padB - (v / max) * (H - padT - padB);
      return [x, y] as [number, number];
    });
  const pT = mapPts(totVals);
  const pB = mapPts(bibVals);
  const toLine = (p: [number, number][]) =>
    p.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" ");
  const toArea = (p: [number, number][]) =>
    `${toLine(p)} L${(W - padR).toFixed(1)} ${(H - padB).toFixed(1)} L${padL} ${(
      H - padB
    ).toFixed(1)} Z`;
  const eT = pT[pT.length - 1];
  const eB = pB[pB.length - 1];
  return (
    <svg
      className="adash-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Cumulative revenue over time"
    >
      <defs>
        <linearGradient id="rc-tot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F5C451" stopOpacity={0.3} />
          <stop offset="1" stopColor="#F5C451" stopOpacity={0.02} />
        </linearGradient>
        <linearGradient id="rc-bib" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6CCDB8" stopOpacity={0.34} />
          <stop offset="1" stopColor="#6CCDB8" stopOpacity={0.03} />
        </linearGradient>
      </defs>
      {[1, 2, 3].map((g) => {
        const gy = padT + (g / 4) * (H - padT - padB);
        return (
          <line
            key={g}
            x1={padL}
            y1={gy.toFixed(1)}
            x2={W - padR}
            y2={gy.toFixed(1)}
            stroke="#1b1b24"
            strokeWidth={1}
          />
        );
      })}
      <path d={toArea(pT)} fill="url(#rc-tot)" />
      <path d={toArea(pB)} fill="url(#rc-bib)" />
      <path d={toLine(pT)} fill="none" stroke="#F5C451" strokeWidth={2.4} strokeLinejoin="round" />
      <path d={toLine(pB)} fill="none" stroke="#6CCDB8" strokeWidth={2.4} strokeLinejoin="round" />
      <circle cx={eT[0].toFixed(1)} cy={eT[1].toFixed(1)} r={4} fill="#F5C451" />
      <circle cx={eB[0].toFixed(1)} cy={eB[1].toFixed(1)} r={4} fill="#6CCDB8" />
    </svg>
  );
}

function Ticker({ events, now }: { events: DashEvent[]; now: number }) {
  if (events.length === 0) {
    return (
      <div className="adash-ticker">
        <span className="lbl">
          <span className="adash-pip" />
          LIVE FEED
        </span>
        <div className="adash-track-wrap">
          <div style={{ padding: "10px 20px", color: "#5f5f72", fontSize: 13 }}>
            Waiting for the first bib or donation…
          </div>
        </div>
      </div>
    );
  }
  const item = (e: DashEvent, i: number, half: string) => {
    const emoji = e.kind === "bib" ? "🎽" : "🙌";
    const verb = e.kind === "bib" ? "bib paid" : "donated";
    const amtClass = e.kind === "bib" ? "bibc" : "donc";
    return (
      <span className="adash-ev" key={`${half}${i}`}>
        <span>{emoji}</span>
        <b>{e.who}</b> {verb}{" "}
        <span className={`amt ${amtClass}`}>{formatUsd(e.amountCents)}</span>
        <span className="ago">· {ago(e.ts, now)}</span>
      </span>
    );
  };
  return (
    <div className="adash-ticker">
      <span className="lbl">
        <span className="adash-pip" />
        LIVE FEED
      </span>
      <div className="adash-track-wrap">
        {/* content duplicated so the marquee loops seamlessly */}
        <div className="adash-track">
          {events.map((e, i) => item(e, i, "a"))}
          {events.map((e, i) => item(e, i, "b"))}
        </div>
      </div>
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
  // Cells may be plain strings or JSX (the inline admin actions).
  rows: React.ReactNode[][];
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
