"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SummaryTiles } from "@/lib/admin-report";
import { validateRingtone, MAX_RINGTONE_LEN } from "@/lib/ringtone";

/**
 * AdminConsole — the interactive user-management surface (Phase 43 UX rework).
 *
 * Renders INSIDE the run.human (protected) chrome. All interaction is
 * client-side over the masked rows the server handed down: instant
 * sort/filter/paginate + a right-side drill-in drawer. Full-email search is the
 * one server round-trip (the /api/admin/users?q= route matches full emails
 * server-side and returns matched userIds) so bulk emails never reach the
 * client. The drawer fetches one user's full email + LIVE quotas on demand.
 *
 * Boring by design: no data libs, no table lib — a plain <table>, a fixed
 * drawer, and the site's own HeroUI/Tailwind tokens (bg-content1, text-primary
 * teal, border-divider) so it reads as native run.human, not a bolt-on.
 */

export type MaskedRow = {
  userId: string;
  displayName: string;
  emailMasked: string;
  bibCode: string | null;
  qrUrl: string;
  signedUpAt: number | null;
  lastLoginAt: number | null;
  lastActivityAt: number | null;
  checkInCount: number;
  gpxRoutes: number;
  gpxSaves: number;
  gpxShares: number;
  gpxUploads: number;
  photoUploads: number;
  uploads: number;
  runnerType: "rabbit" | "admin" | "wildhare" | "og" | null;
  services: string[];
};

type SortKey = "signup" | "lastActivity" | "gpxUsage" | "name";
type QuotaDetail = {
  quotaId: string;
  remaining: number;
  initialAmount: number;
  totalConsumed: number;
  consumptionCount: number;
};
type UserDetail = {
  email: string | null;
  quotaTier: string | null;
  quotas: QuotaDetail[];
  ringtone: string | null;
  mqttUsertype: "rabbit" | "admin" | "wildhare" | "og" | null;
};

const WEEK = 7 * 24 * 60 * 60 * 1000;
const gpxUsage = (r: MaskedRow) => r.gpxRoutes + r.gpxSaves + r.gpxShares;

/** Semantic colour for a service tag. */
const SVC_COLOR: Record<string, string> = {
  admin: "#ff5c72",
  runadmin: "#9a7cff",
  run: "#00d4aa",
  gpx: "#f5a623",
  cms: "#37c7e0",
};
/** Runner class (mqttUsertype) colour + short label. wildhare renders as "hare". */
const RUNNER_COLOR: Record<string, string> = {
  admin: "#ff5c72",
  wildhare: "#f5a623",
  rabbit: "#37c7e0",
  og: "#9a7cff",
};
const RUNNER_LABEL: Record<string, string> = {
  admin: "admin",
  wildhare: "hare",
  rabbit: "rabbit",
  og: "og",
};
/** Human labels for known quota ids; unknown ids fall back to the raw id. */
const QUOTA_LABEL: Record<string, string> = {
  gpx_upload: "GPX uploads",
  gpx_save: "GPX saves",
  gpx_share: "GPX shares",
  photo_upload: "Photos",
  file_upload: "File uploads",
  checkin: "Check-ins",
  qr_scan: "QR scans",
  qr_sheet: "QR sheets",
  strava_sync: "Strava sync",
  meshtastic_radio: "Meshtastic",
  displayname_change: "Name changes",
};

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function rel(ts: number | null): string {
  if (!ts) return "never";
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  const d = s / 86400;
  return d < 45 ? `${Math.round(d)}d` : `${Math.round(d / 30)}mo`;
}
/** Recency colour: fresh → teal, this fortnight → amber, stale → muted. */
function recencyClass(ts: number | null): string {
  if (!ts) return "text-default-400";
  const d = (Date.now() - ts) / 86400000;
  return d < 2 ? "text-primary" : d < 14 ? "text-warning" : "text-default-400";
}
/** Quota bar fill colour by pressure. */
function barColor(used: number, limit: number): string {
  if (limit <= 0) return "#00d4aa";
  const p = used / limit;
  return p >= 0.9 ? "#ff5c72" : p >= 0.6 ? "#f5a623" : "#00d4aa";
}

export function AdminConsole({
  rows,
  summary,
  apiBase,
  adminEmail,
}: {
  rows: MaskedRow[];
  summary: SummaryTiles;
  apiBase: string;
  adminEmail: string | null;
}) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("signup");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(200);
  const [emailIds, setEmailIds] = useState<Set<string> | null>(null);

  const [selected, setSelected] = useState<MaskedRow | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revealEmail, setRevealEmail] = useState(false);
  const [ringtoneDraft, setRingtoneDraft] = useState("");
  const [ringtoneSaving, setRingtoneSaving] = useState(false);
  const [ringtoneMsg, setRingtoneMsg] = useState<string | null>(null);

  // ── Server-side full-email search (privacy: bulk emails never reach us) ────
  const searchSeq = useRef(0);
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setEmailIds(null);
      return;
    }
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/admin/users?q=${encodeURIComponent(needle)}&pageSize=500`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(String(res.status));
        const data: { rows: { userId: string }[] } = await res.json();
        if (seq === searchSeq.current)
          setEmailIds(new Set(data.rows.map((r) => r.userId)));
      } catch {
        if (seq === searchSeq.current) setEmailIds(null);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q, apiBase]);

  const toggleFilter = (f: string) =>
    setFilters((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "name" ? 1 : -1);
    }
    setPage(0);
  };

  // ── filter → sort ──────────────────────────────────────────────────────────
  const view = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (ql) {
        const hit =
          r.displayName.toLowerCase().includes(ql) ||
          (r.bibCode ?? "").toLowerCase().includes(ql) ||
          r.emailMasked.toLowerCase().includes(ql) ||
          r.services.join(" ").toLowerCase().includes(ql) ||
          (emailIds?.has(r.userId) ?? false);
        if (!hit) return false;
      }
      if (filters.has("gpx") && gpxUsage(r) === 0 && r.gpxUploads === 0) return false;
      if (filters.has("bib") && !r.bibCode) return false;
      if (
        filters.has("active") &&
        !(r.lastActivityAt && Date.now() - r.lastActivityAt <= WEEK)
      )
        return false;
      if (filters.has("admin") && r.runnerType !== "admin") return false;
      if (filters.has("hare") && r.runnerType !== "wildhare") return false;
      return true;
    });
    const keyOf = (r: MaskedRow): number | string => {
      switch (sortKey) {
        case "name":
          return r.displayName.toLowerCase();
        case "gpxUsage":
          return gpxUsage(r);
        case "lastActivity":
          return r.lastActivityAt ?? 0;
        case "signup":
        default:
          return r.signedUpAt ?? 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = keyOf(a),
        bv = keyOf(b);
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    });
  }, [rows, q, emailIds, filters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(view.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * pageSize;
  const slice = view.slice(start, start + pageSize);

  // ── drawer detail fetch ─────────────────────────────────────────────────────
  const openUser = (r: MaskedRow) => {
    setSelected(r);
    setDetail(null);
    setRevealEmail(false);
    setDetailLoading(true);
    setRingtoneDraft("");
    setRingtoneMsg(null);
    fetch(`${apiBase}/api/admin/users/${r.userId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((d: UserDetail) => {
        setDetail(d);
        setRingtoneDraft(d.ringtone ?? "");
      })
      .catch(() =>
        setDetail({
          email: null,
          quotaTier: null,
          quotas: [],
          ringtone: null,
          mqttUsertype: null,
        })
      )
      .finally(() => setDetailLoading(false));
  };
  const closeDrawer = () => setSelected(null);

  // Set or clear (null) a runner's ringtone via the admin PATCH. Reuses the
  // shared RTTTL validator for pre-flight so bad input never hits the network.
  const saveRingtone = async (value: string | null) => {
    if (!selected) return;
    const check = validateRingtone(value);
    if (!check.ok) {
      setRingtoneMsg(check.reason);
      return;
    }
    setRingtoneSaving(true);
    setRingtoneMsg(null);
    try {
      const res = await fetch(`${apiBase}/api/admin/users/${selected.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ringtone: check.value }),
      });
      if (!res.ok) {
        setRingtoneMsg(
          res.status === 404 ? "not authorized" : `save failed (${res.status})`
        );
        return;
      }
      const data = (await res.json()) as { ringtone: string | null };
      setRingtoneDraft(data.ringtone ?? "");
      setDetail((d) => (d ? { ...d, ringtone: data.ringtone } : d));
      setRingtoneMsg("saved");
    } catch {
      setRingtoneMsg("save failed");
    } finally {
      setRingtoneSaving(false);
    }
  };
  // Esc closes; j/k step to the next/prev user in the CURRENT filtered+sorted
  // view while the drawer is open (skipped when a form field has focus). Jumps
  // the page so the highlighted row stays visible.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      if (!selected || (e.key !== "j" && e.key !== "k")) return;
      const el = document.activeElement;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      const idx = view.findIndex((r) => r.userId === selected.userId);
      if (idx < 0) return;
      const next = Math.min(
        view.length - 1,
        Math.max(0, idx + (e.key === "j" ? 1 : -1))
      );
      if (next === idx) return;
      e.preventDefault();
      setPage(Math.floor(next / pageSize));
      openUser(view[next]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, view, pageSize]);

  // ── client-side tiles (from the full row set) ───────────────────────────────
  const tiles = useMemo(() => {
    const now = Date.now();
    return [
      { k: "Total users", v: rows.length },
      { k: "New · 7d", v: summary.newSignups7d },
      { k: "Active · 7d", v: summary.active7d },
      { k: "Using GPX", v: rows.filter((r) => gpxUsage(r) > 0 || r.gpxUploads > 0).length },
      { k: "Have a bib", v: rows.filter((r) => r.bibCode).length },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, summary]);

  const csvHref = `${apiBase}/api/admin/users?format=csv&sort=${
    sortKey === "gpxUsage" ? "gpxUsage" : sortKey === "lastActivity" ? "lastActivity" : "signup"
  }${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;

  const Arrow = ({ k }: { k: SortKey }) =>
    sortKey === k ? <span className="text-primary">{sortDir < 0 ? " ▼" : " ▲"}</span> : null;

  return (
    <div className="flex flex-col gap-5 py-2">
      {/* ── page header ─────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-museo text-2xl font-bold tracking-tight">
            defcon<span className="teal-dot">.</span>run 34 · Admin
          </h1>
          <p className="text-sm text-default-500 mt-1">
            User management &amp; activity
            {adminEmail ? (
              <>
                {" · signed in as "}
                <span className="font-mono blur-[3px] hover:blur-none transition-[filter]">
                  {maskEmail(adminEmail)}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/qr"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-divider bg-content1 text-foreground text-[13px] font-semibold hover:bg-content2 transition-colors"
          >
            QR / CTF →
          </Link>
          <Link
            href="/admin/leaderboard"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-divider bg-content1 text-foreground text-[13px] font-semibold hover:bg-content2 transition-colors"
          >
            CTF Leaderboard →
          </Link>
          <Link
            href="/admin/ghosts"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-divider bg-content1 text-foreground text-[13px] font-semibold hover:bg-content2 transition-colors"
          >
            👻 Ghosts →
          </Link>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-primary">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_0_3px_rgba(0,212,170,0.18)]" />
            live
          </span>
        </div>
      </div>

      {/* ── tiles ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {tiles.map((t) => (
          <div
            key={t.k}
            className="bg-content1 border border-divider rounded-xl px-3.5 py-3 flex flex-col gap-0.5"
          >
            <span className="text-[11px] uppercase tracking-wide text-default-400">{t.k}</span>
            <span className="text-2xl font-semibold tabular-nums leading-none">
              {t.v.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* ── toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-[400px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400">⌕</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            type="search"
            placeholder="search email · name · bib · service…"
            spellCheck={false}
            autoComplete="off"
            className="w-full h-9 rounded-lg border border-divider bg-content1 text-foreground font-mono text-[13px] pl-8 pr-3 outline-none focus:border-primary"
          />
        </div>
        {[
          { f: "gpx", label: "uses gpx" },
          { f: "bib", label: "has bib" },
          { f: "active", label: "active 7d" },
          { f: "admin", label: "admins" },
          { f: "hare", label: "hares" },
        ].map(({ f, label }) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              toggleFilter(f);
              setPage(0);
            }}
            aria-pressed={filters.has(f)}
            className={`font-mono text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filters.has(f)
                ? "border-primary text-primary bg-primary/10"
                : "border-divider text-default-500 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <a
          href={csvHref}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-black text-[13px] font-semibold hover:opacity-90"
        >
          ↓ CSV
        </a>
      </div>

      {/* ── table ───────────────────────────────────────────────────────── */}
      <div className="bg-content1 border border-divider rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-content2 text-[11px] uppercase tracking-wide text-default-400">
                <Th onClick={() => setSort("name")}>User<Arrow k="name" /></Th>
                <Th onClick={() => setSort("signup")}>Signed up<Arrow k="signup" /></Th>
                <Th onClick={() => setSort("lastActivity")}>Last active<Arrow k="lastActivity" /></Th>
                <Th onClick={() => setSort("gpxUsage")}>GPX<Arrow k="gpxUsage" /></Th>
                <Th>Type</Th>
                <Th>Services</Th>
                <Th>Bib</Th>
              </tr>
            </thead>
            <tbody>
              {slice.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-default-400 text-sm">
                    No users match the current filter.
                  </td>
                </tr>
              ) : (
                slice.map((r) => {
                  const gp = Math.min(1, r.gpxUploads / 50);
                  return (
                    <tr
                      key={r.userId}
                      onClick={() => openUser(r)}
                      className={`cursor-pointer border-t border-divider hover:bg-content2 ${
                        selected?.userId === r.userId ? "bg-primary/10" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-7 h-7 rounded-lg grid place-items-center text-[11px] font-semibold text-black shrink-0"
                            style={{ background: avatarColor(r.userId) }}
                          >
                            {(r.displayName || "??").slice(0, 2).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] truncate">
                              {r.displayName || "—"}
                            </span>
                            <span className="block font-mono text-[10.5px] text-default-400 blur-[3px] hover:blur-none transition-[filter]">
                              {r.emailMasked || "—"}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[12.5px] whitespace-nowrap">
                        {fmtDate(r.signedUpAt)}
                        <span className="block text-[10.5px] text-default-400">
                          {rel(r.signedUpAt)} ago
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 font-mono text-[12.5px] whitespace-nowrap ${recencyClass(r.lastActivityAt)}`}>
                        {r.lastActivityAt ? `${rel(r.lastActivityAt)} ago` : "never"}
                        <span className="block text-[10.5px] text-default-400">
                          {fmtDate(r.lastActivityAt)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {r.gpxUploads > 0 || gpxUsage(r) > 0 ? (
                          <div className="flex items-center gap-2 min-w-[100px]">
                            <span className="flex-1 h-1.5 rounded bg-content3 overflow-hidden">
                              <span
                                className="block h-full rounded"
                                style={{ width: `${gp * 100}%`, background: barColor(r.gpxUploads, 50) }}
                              />
                            </span>
                            <span className="font-mono text-[11.5px] text-default-500 tabular-nums">
                              {r.gpxUploads}
                            </span>
                          </div>
                        ) : (
                          <span className="text-default-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.runnerType ? (
                          <RunnerTag t={r.runnerType} />
                        ) : (
                          <span className="text-default-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex gap-1 flex-wrap">
                          {r.services.map((s) => (
                            <Tag key={s} s={s} />
                          ))}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {r.bibCode ? (
                          <span className="font-mono text-[12px] tracking-wide px-1.5 py-0.5 rounded bg-content3 border border-divider">
                            {r.bibCode}
                          </span>
                        ) : (
                          <span className="font-mono text-[12px] text-default-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── pager ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-t border-divider bg-content2 text-[12.5px] text-default-500">
          <span className="font-mono">
            {view.length === 0
              ? "no matches"
              : `${start + 1}–${Math.min(start + pageSize, view.length)} of ${view.length.toLocaleString()}`}
          </span>
          <div className="flex-1" />
          <label className="text-default-400">
            rows{" "}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="h-7 rounded-md border border-divider bg-content1 text-foreground font-mono"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <Pg label="‹" disabled={clampedPage <= 0} onClick={() => setPage(clampedPage - 1)} />
          <span className="font-mono tabular-nums">
            {clampedPage + 1} / {totalPages}
          </span>
          <Pg label="›" disabled={clampedPage >= totalPages - 1} onClick={() => setPage(clampedPage + 1)} />
        </div>
      </div>

      <p className="text-[11.5px] text-default-400">
        Emails are masked + blurred; hover to peek the mask, drill in to reveal one. Full emails
        never load in bulk — search matches them server-side. With a user open, <kbd>j</kbd> /{" "}
        <kbd>k</kbd> step to the next / previous user. Quota usage is a proxy for activity;
        session-log reads come later.
      </p>

      {/* ── drawer ──────────────────────────────────────────────────────── */}
      {selected ? (
        <>
          <div
            onClick={closeDrawer}
            className="fixed inset-0 z-40 bg-black/50"
            aria-hidden
          />
          <aside
            className="fixed top-0 right-0 z-50 h-dvh w-[420px] max-w-[92vw] bg-background border-l border-divider shadow-2xl flex flex-col"
            aria-label="User detail"
          >
            <div className="flex items-start gap-3 p-4 border-b border-divider">
              <span
                className="w-10 h-10 rounded-lg grid place-items-center text-sm font-semibold text-black shrink-0"
                style={{ background: avatarColor(selected.userId) }}
              >
                {(selected.displayName || "??").slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[15px] font-medium truncate">{selected.displayName || "—"}</span>
                  {selected.runnerType ? <RunnerTag t={selected.runnerType} /> : null}
                </div>
                <div className="font-mono text-[11px] text-default-400 truncate">
                  {revealEmail && detail?.email ? (
                    <span className="text-primary">{detail.email}</span>
                  ) : (
                    <span className="blur-[3px]">{selected.emailMasked || "—"}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRevealEmail((v) => !v)}
                disabled={!detail?.email}
                title="Reveal email"
                className="w-8 h-8 rounded-lg border border-divider text-default-500 hover:text-primary hover:border-primary disabled:opacity-40"
              >
                👁
              </button>
              <button
                type="button"
                onClick={closeDrawer}
                title="Close"
                className="w-8 h-8 rounded-lg border border-divider text-default-500 hover:text-primary hover:border-primary"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto p-4 flex flex-col gap-4">
              <Section title="Timeline">
                <Kv k="Signed up" v={`${fmtDate(selected.signedUpAt)} · ${rel(selected.signedUpAt)} ago`} />
                <Kv k="Last login" v={selected.lastLoginAt ? `${fmtDate(selected.lastLoginAt)} · ${rel(selected.lastLoginAt)} ago` : "—"} />
                <Kv k="Last active" v={selected.lastActivityAt ? `${fmtDate(selected.lastActivityAt)} · ${rel(selected.lastActivityAt)} ago` : "never"} />
              </Section>

              <Section title="Services">
                <div className="flex gap-1.5 flex-wrap">
                  {selected.services.length ? (
                    selected.services.map((s) => <Tag key={s} s={s} />)
                  ) : (
                    <span className="text-default-400 text-xs">none</span>
                  )}
                </div>
              </Section>

              <Section title="Ringtone">
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={ringtoneDraft}
                    onChange={(e) => setRingtoneDraft(e.target.value)}
                    placeholder="RTTTL, e.g. og:d=8,o=5,b=110:g,p,g"
                    maxLength={MAX_RINGTONE_LEN}
                    className="w-full rounded-lg border border-divider bg-content2 px-2.5 py-1.5 font-mono text-[12px] focus:border-primary outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveRingtone(ringtoneDraft)}
                      disabled={ringtoneSaving}
                      className="rounded-lg bg-primary px-3 py-1 text-[12px] font-medium text-black disabled:opacity-50"
                    >
                      {ringtoneSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveRingtone(null)}
                      disabled={
                        ringtoneSaving || (!ringtoneDraft && !detail?.ringtone)
                      }
                      className="rounded-lg border border-divider px-3 py-1 text-[12px] text-default-500 hover:text-primary hover:border-primary disabled:opacity-40"
                    >
                      Clear
                    </button>
                    {ringtoneMsg ? (
                      <span
                        className={`text-[11px] ${
                          ringtoneMsg === "saved" ? "text-success" : "text-danger"
                        }`}
                      >
                        {ringtoneMsg}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-default-400">
                    {detail?.ringtone
                      ? "Personal override set."
                      : `Empty → class default (${
                          detail?.mqttUsertype ?? selected.runnerType ?? "rabbit"
                        }).`}
                  </span>
                </div>
              </Section>

              <Section title={`Quota usage${detail?.quotaTier ? ` · ${detail.quotaTier} tier` : ""}`}>
                {detailLoading ? (
                  <span className="text-default-400 text-xs">loading…</span>
                ) : detail && detail.quotas.length ? (
                  detail.quotas.map((qd) => {
                    const limit = qd.initialAmount;
                    const used = Math.max(0, limit - qd.remaining);
                    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : used > 0 ? 100 : 0;
                    return (
                      <div key={qd.quotaId} className="grid grid-cols-[84px_1fr_58px] items-center gap-2.5 mb-2">
                        <span className="text-[12px] text-default-500">
                          {QUOTA_LABEL[qd.quotaId] ?? qd.quotaId}
                        </span>
                        <span className="h-1.5 rounded bg-content3 overflow-hidden">
                          <span className="block h-full rounded" style={{ width: `${pct}%`, background: barColor(used, limit) }} />
                        </span>
                        <span className="font-mono text-[12px] text-default-500 text-right tabular-nums">
                          {used}/{limit}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <span className="text-default-400 text-xs">no quota records</span>
                )}
              </Section>

              <Section title="Activity">
                <Kv k="GPX files" v={String(selected.gpxUploads)} />
                <Kv k="GPX r/s/sh" v={`${selected.gpxRoutes}/${selected.gpxSaves}/${selected.gpxShares}`} />
                <Kv k="Photos" v={String(selected.photoUploads)} />
                <Kv k="Check-ins" v={String(selected.checkInCount)} />
              </Section>

              <Section title="Bib / runner">
                {selected.bibCode ? (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm tracking-wide px-2 py-1 rounded bg-content3 border border-divider">
                      {selected.bibCode}
                    </span>
                    <a
                      href={selected.qrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-primary hover:underline"
                    >
                      open QR ↗
                    </a>
                  </div>
                ) : (
                  <span className="text-default-400 text-xs">no bib claimed</span>
                )}
              </Section>

              <Section title="Identity">
                <Kv k="Adapter id" v={selected.userId} mono />
                <p className="text-[11px] text-default-400 mt-1">
                  Read-only. Session-log reads (which app areas a user visits) come later.
                </p>
              </Section>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

/* ── small presentational bits ──────────────────────────────────────────── */

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th
      onClick={onClick}
      className={`text-left font-semibold px-4 py-2.5 whitespace-nowrap ${onClick ? "cursor-pointer hover:text-foreground select-none" : ""}`}
    >
      {children}
    </th>
  );
}
function Pg({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 rounded-md border border-divider font-mono hover:border-primary disabled:opacity-35"
    >
      {label}
    </button>
  );
}
function Tag({ s }: { s: string }) {
  const c = SVC_COLOR[s] ?? "#8888a0";
  return (
    <span
      className="font-mono text-[10.5px] uppercase tracking-wide px-1.5 py-0.5 rounded border"
      style={{ color: c, borderColor: `${c}66`, background: `${c}1f` }}
    >
      {s}
    </span>
  );
}
function RunnerTag({ t }: { t: string }) {
  const c = RUNNER_COLOR[t] ?? "#8888a0";
  return (
    <span
      className="font-mono text-[10.5px] uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0"
      style={{ color: c, borderColor: `${c}66`, background: `${c}1f` }}
    >
      {RUNNER_LABEL[t] ?? t}
    </span>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-divider pb-4 last:border-none last:pb-0">
      <h4 className="text-[11px] uppercase tracking-wider text-default-400 font-semibold mb-2.5">{title}</h4>
      {children}
    </div>
  );
}
function Kv({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      <span className="text-default-400">{k}</span>
      <span className={mono ? "font-mono break-all" : "font-mono"}>{v}</span>
    </div>
  );
}

/** Local mask for the signed-in admin email (server already masks user rows). */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}
/** Stable per-user avatar colour from the id. */
function avatarColor(id: string): string {
  const palette = ["#00d4aa", "#37c7e0", "#f5a623", "#9a7cff", "#ff8a5c", "#4ad991", "#e06fb0"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return palette[h % palette.length];
}
