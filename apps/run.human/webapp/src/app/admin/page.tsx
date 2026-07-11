import type { CSSProperties, ReactNode } from "react";

import { notFound } from "next/navigation";

import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin } from "@/lib/admin-gate";
import {
  buildUserReport,
  filterByEmail,
  sortRows,
  summaryTiles,
  maskEmail,
  type ReportSort,
  type UserReportRow,
} from "@/lib/admin-report";

/**
 * /admin — Phase 43 run.human admin reporting dashboard (ADMN-01/06/07).
 *
 * Boring, single-file server component. Gates on entry (requireAdmin + a live
 * fresh-claims revalidateAdmin), renders four summary tiles + a sortable,
 * paginated user table with masked emails, a per-row reveal, a full-email
 * search box, runner-QR/bib-code columns, and a Download-CSV link.
 *
 * ── Gate / non-disclosure (T-43-01 / T-43-02 / T-43-06) ─────────────────────
 * EVERY denial collapses to notFound() (404) — never a 403, never the
 * dashboard — so the route's existence is not advertised. Three denial paths:
 *   1. requireAdmin fails (no session / not "admin" group),
 *   2. session.user.authUserId (the OIDC sub) is missing,
 *   3. revalidateAdmin(authUserId) fails the live claims check (stale admin).
 *
 * IDENTIFIER LANDMINE: revalidateAdmin MUST be called with
 * `session.user.authUserId` (the auth.defcon.run OIDC sub) — NOT
 * `session.user.id`, the Auth.js DynamoDB-adapter local uuid. The run.auth
 * validate endpoint is keyed by the OIDC sub; passing the adapter id silently
 * fails the lookup and 404s a real admin.
 *
 * ── PII (T-43-03) ───────────────────────────────────────────────────────────
 * Emails render masked by default (maskEmail); the FULL email crosses to the
 * DOM only for the single row whose userId === ?reveal. There is no unrevealed
 * full-email column; full data lives only in the gated CSV export.
 *
 * Node runtime — the ElectroDB/AWS-SDK scan pipeline needs Node crypto for
 * request signing. Force-dynamic — always a live scan, never cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: ReportSort[] = ["lastActivity", "gpxUsage", "signup"];

/**
 * Base path for the CSV API link. In production the app is mounted at
 * `/{region}` (basePath); a plain <a href> is NOT auto-prefixed, so mirror the
 * bib apiBase() idiom and prepend it. Dev has no basePath. (Relative `?...`
 * links on this page stay on /admin under the same basePath automatically, so
 * only the cross-route CSV anchor needs this.)
 */
function apiBase(): string {
  return process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";
}

/** Build a relative `?...` href for this page, dropping empty params. PURE. */
function href(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "?";
}

/** Compact server-side timestamp render (force-dynamic → Date.now is fine). */
function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // ── Gate (fail-closed; every denial → 404, never a 403 / never the page) ───
  const session = await auth();
  const gate = requireAdmin(session);
  if (!gate.ok) notFound();

  // Fresh-claims revalidation keyed by the OIDC sub (NOT the adapter id). A
  // missing authUserId OR a stale/revoked admin both 404.
  const authUserId = session?.user?.authUserId;
  if (!authUserId || !(await revalidateAdmin(authUserId))) notFound();

  // ── Params (all state is URL-driven) ───────────────────────────────────────
  const sp = await searchParams;
  const q = sp.q ?? "";
  const sortParam = sp.sort;
  const sort: ReportSort = SORTS.includes(sortParam as ReportSort)
    ? (sortParam as ReportSort)
    : "lastActivity";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(1, Number.parseInt(sp.pageSize ?? "50", 10) || 50)
  );
  const reveal = sp.reveal ?? null;

  // ── Assemble → filter → sort (the current view) ────────────────────────────
  const all = await buildUserReport();
  const filtered = filterByEmail(all, q);
  const view = sortRows(filtered, sort);
  const tiles = summaryTiles(filtered);

  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const slice = view.slice(start, start + pageSize);

  // CSV export carries the current filter/sort so the file matches the view;
  // region-basePath-prefixed because a plain <a> is not auto-prefixed in prod.
  const csvParams = new URLSearchParams({ sort });
  if (q) csvParams.set("q", q);
  const csvHref = `${apiBase()}/api/admin/users?format=csv&${csvParams.toString()}`;

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#0b0f14",
        color: "#e6edf3",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "40px 20px 96px",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
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
              defcon<span style={{ color: "#6CCDB8" }}>.</span>run 34 · Admin
            </h1>
            <p style={{ margin: 0, color: "#8b98a5", fontSize: 14 }}>
              User reporting · signed in as {gate.email ?? "admin"}.
            </p>
          </div>
          <a
            href={csvHref}
            style={{
              alignSelf: "center",
              padding: "9px 16px",
              borderRadius: 8,
              border: "1px solid #2a3745",
              backgroundColor: "#16202b",
              color: "#e6edf3",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            ↓ Download CSV
          </a>
        </header>

        {/* ── Summary tiles ─────────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
          }}
        >
          <Tile k="Total users" v={tiles.totalUsers} />
          <Tile k="New signups · 7d" v={tiles.newSignups7d} />
          <Tile k="Active · 7d" v={tiles.active7d} />
          <Tile k="GPX-active" v={tiles.withGpxActivity} />
        </div>

        {/* ── Search (server-side full-email filter via ?q) ─────────────── */}
        <form
          method="GET"
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        >
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search full email…"
            style={{
              flex: "1 1 260px",
              minWidth: 200,
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid #2a3745",
              backgroundColor: "#0f1620",
              color: "#e6edf3",
              fontSize: 14,
            }}
          />
          {/* Preserve the active sort across a search; reset to page 1. */}
          <input type="hidden" name="sort" value={sort} />
          <button
            type="submit"
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              border: "1px solid #2a3745",
              backgroundColor: "#16202b",
              color: "#e6edf3",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Search
          </button>
          {q ? (
            <a href={href({ sort })} style={{ color: "#8b98a5", fontSize: 13 }}>
              clear
            </a>
          ) : null}
        </form>

        {/* ── Sort controls ─────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            color: "#8b98a5",
            fontSize: 13,
            flexWrap: "wrap",
          }}
        >
          <span>Sort:</span>
          <SortLink label="Last activity" value="lastActivity" active={sort} q={q} />
          <SortLink label="GPX usage" value="gpxUsage" active={sort} q={q} />
          <SortLink label="Signup" value="signup" active={sort} q={q} />
        </div>

        {/* ── User table ────────────────────────────────────────────────── */}
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              minWidth: 1100,
              fontSize: 12.5,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            <thead>
              <tr>
                {[
                  "Name",
                  "Email",
                  "Bib",
                  "Runner QR",
                  "Signed up",
                  "Last login",
                  "Last activity",
                  "Check-ins",
                  "GPX r/s/sh",
                  "Uploads",
                  "Services",
                ].map((c, idx) => (
                  <th key={c} style={thStyle(idx === 0)}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: 16, color: "#8b98a5" }}>
                    No users match the current filter.
                  </td>
                </tr>
              ) : (
                slice.map((row: UserReportRow) => {
                  const revealed = reveal === row.userId;
                  return (
                    <tr key={row.userId}>
                      <td style={tdStyle(true)}>{row.displayName || "—"}</td>
                      <td style={tdStyle(false)}>
                        {revealed ? (
                          <span style={{ color: "#f0d060" }}>
                            {row.emailFull || "—"}
                          </span>
                        ) : (
                          // Masked by default; click reveals ONLY this row.
                          <a
                            href={href({
                              q,
                              sort,
                              page,
                              reveal: row.userId,
                            })}
                            style={{ color: "#6CCDB8", textDecoration: "none" }}
                            title="Reveal full email"
                          >
                            {maskEmail(row.emailFull) || "—"}
                          </a>
                        )}
                      </td>
                      <td style={tdStyle(false)}>{row.bibCode || ""}</td>
                      <td style={tdStyle(false)}>
                        <a
                          href={row.qrUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#6CCDB8" }}
                        >
                          {row.qrUrl}
                        </a>
                      </td>
                      <td style={tdStyle(false)}>{fmtDate(row.signedUpAt)}</td>
                      <td style={tdStyle(false)}>{fmtDate(row.lastLoginAt)}</td>
                      <td style={tdStyle(false)}>{fmtDate(row.lastActivityAt)}</td>
                      <td style={tdStyle(false)}>{row.checkInCount}</td>
                      <td style={tdStyle(false)}>
                        {row.gpxRoutes}/{row.gpxSaves}/{row.gpxShares}
                      </td>
                      <td style={tdStyle(false)}>{row.uploads}</td>
                      <td style={tdStyle(false)}>{row.services.join(", ")}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            color: "#8b98a5",
            fontSize: 13,
            flexWrap: "wrap",
          }}
        >
          <span>
            {total === 0
              ? "0 users"
              : `${start + 1}–${Math.min(start + pageSize, total)} of ${total} · page ${page}/${totalPages}`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <PageLink
              label="← Prev"
              disabled={page <= 1}
              href={href({ q, sort, page: page - 1, pageSize })}
            />
            <PageLink
              label="Next →"
              disabled={page >= totalPages}
              href={href({ q, sort, page: page + 1, pageSize })}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

/** Summary tile. */
function Tile({ k, v }: { k: string; v: number }) {
  return (
    <div
      style={{
        border: "1px solid #2a3745",
        backgroundColor: "#0f1620",
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span style={{ color: "#8b98a5", fontSize: 12.5, letterSpacing: 0.3 }}>{k}</span>
      <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{v}</span>
    </div>
  );
}

/** Sort header link; the active sort is highlighted. Search (q) is preserved. */
function SortLink({
  label,
  value,
  active,
  q,
}: {
  label: string;
  value: ReportSort;
  active: ReportSort;
  q: string;
}) {
  const isActive = active === value;
  return (
    <a
      href={href({ q, sort: value })}
      style={{
        padding: "5px 10px",
        borderRadius: 7,
        border: "1px solid #2a3745",
        backgroundColor: isActive ? "#1c2b3a" : "transparent",
        color: isActive ? "#e6edf3" : "#8b98a5",
        textDecoration: "none",
        fontWeight: isActive ? 700 : 500,
      }}
    >
      {label}
      {isActive ? " ▾" : ""}
    </a>
  );
}

/** Pagination link that renders inert (non-link) when disabled. */
function PageLink({
  label,
  href: to,
  disabled,
}: {
  label: string;
  href: string;
  disabled: boolean;
}): ReactNode {
  const base: CSSProperties = {
    padding: "6px 12px",
    borderRadius: 7,
    border: "1px solid #2a3745",
    fontSize: 13,
  };
  if (disabled) {
    return (
      <span style={{ ...base, color: "#4a5560", backgroundColor: "transparent" }}>
        {label}
      </span>
    );
  }
  return (
    <a
      href={to}
      style={{ ...base, color: "#e6edf3", backgroundColor: "#16202b", textDecoration: "none" }}
    >
      {label}
    </a>
  );
}

/** Table header cell style; first column sticks while the rest scrolls. */
function thStyle(sticky: boolean): CSSProperties {
  return {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: "1px solid #2a3745",
    color: "#8b98a5",
    fontWeight: 600,
    whiteSpace: "nowrap",
    ...(sticky
      ? {
          position: "sticky",
          left: 0,
          zIndex: 2,
          backgroundColor: "#0b0f14",
          borderRight: "1px solid #2a3745",
        }
      : {}),
  };
}

/** Table body cell style; first column sticks while the rest scrolls. */
function tdStyle(sticky: boolean): CSSProperties {
  return {
    padding: "7px 10px",
    borderBottom: "1px solid #1b2530",
    color: "#e6edf3",
    whiteSpace: "nowrap",
    ...(sticky
      ? {
          position: "sticky",
          left: 0,
          zIndex: 1,
          backgroundColor: "#0b0f14",
          borderRight: "1px solid #2a3745",
        }
      : {}),
  };
}
