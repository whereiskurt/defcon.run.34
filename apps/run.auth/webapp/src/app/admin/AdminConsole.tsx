"use client";
import { useEffect, useMemo, useState, type ComponentType, type CSSProperties } from "react";
import type { IdentityRow, IdentitySort, SummaryTiles, ProviderKey } from "@/lib/identity-report";
import { LockAction, UnlinkAction, DeleteIdentityAction, JailAction } from "./AdminActions";
import { SiGithub, SiDiscord, SiStrava } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { Mail, Users, UserPlus, Layers, Lock, ShieldAlert } from "lucide-react";

// Loose icon type so react-icons (IconType) and lucide (LucideIcon) both fit.
type Ico = ComponentType<{ size?: number; style?: CSSProperties }>;

// In production the app is mounted at basePath /{region}; client fetches MUST
// prefix it or they 404 (the routes live at /use1/api/..., not /api/...).
const BASE = process.env.NODE_ENV === "production"
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
  : "";

// This panel is admin-only (non-disclosure 404 for everyone else) and seen by
// ~2 trusted admins, so we ship the full email to the client for direct search
// + reveal, rather than the masked-only projection used by less-restricted views.
type Row = IdentityRow;
type RunHumanRef = { found: boolean; runUserId: string | null; displayName: string | null };
type Detail = {
  identity: { userId: string; displayName: string; email: string | null; services: string[];
    lastProvider: string | null; createdAt: number | null; lockedOut: boolean;
    lockoutReason: string | null; sessionVersion: number; jailed: boolean; jailLevel: number | null };
  accounts: { provider: string; providerAccountId: string; userId: string }[];
  oidcSessions: { id: string; expiresAt: number | null }[];
  runHuman: RunHumanRef;
};
type IpRow = { ip: string; logins: number; firstSeen: string | null; lastSeen: string | null; agents: number };
type UserRow = { userId: string; email: string | null; logins: number; firstSeen: string | null; lastSeen: string | null };

// Provider brand table — chips render ONLY the linked providers, brand-colored.
const PROVIDER_META: Record<ProviderKey, { label: string; color: string; Icon: Ico }> = {
  github: { label: "GH", color: "#e4e4ef", Icon: SiGithub },
  discord: { label: "DC", color: "#5865F2", Icon: SiDiscord },
  linkedin: { label: "IN", color: "#0A66C2", Icon: FaLinkedin },
  strava: { label: "ST", color: "#FC4C02", Icon: SiStrava },
  email: { label: "EM", color: "#8888a0", Icon: Mail },
};
const PROVIDER_ORDER: ProviderKey[] = ["github", "discord", "linkedin", "strava", "email"];

// Group/service tag colors, mirroring run.human's admin color map.
const GROUP_COLOR: Record<string, string> = {
  run: "#00d4aa", runadmin: "#9a7cff", admin: "#ff5c72", strava: "#FC4C02",
  gpxstudio: "#f5a623", gpx: "#f5a623", flash: "#37c7e0", cms: "#37c7e0", auth: "#8888a0",
};
const groupColor = (g: string) => GROUP_COLOR[g] ?? "#8888a0";

const AV_COLORS = ["#00d4aa", "#37c7e0", "#9a7cff", "#f5a623", "#FC4C02", "#ff5c72", "#7fdc9e"];
const avatarColor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
  return AV_COLORS[h % AV_COLORS.length];
};

function ProviderChip({ p }: { p: ProviderKey }) {
  const { label, color, Icon } = PROVIDER_META[p];
  return (
    <span title={p}
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-bold"
      style={{ color, borderColor: `${color}66`, background: `${color}1f` }}>
      <Icon size={11} /> {label}
    </span>
  );
}

function Tag({ g }: { g: string }) {
  const c = groupColor(g);
  return (
    <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
      style={{ color: c, borderColor: `${c}66`, background: `${c}1f` }}>{g}</span>
  );
}

/** Daily-signup sparkline computed client-side from row createdAt. */
function Sparkline({ series, color }: { series: number[]; color: string }) {
  const W = 260, H = 30, pad = 3;
  const max = Math.max(1, ...series);
  const n = series.length;
  const pts = series.map((v, i) => {
    const x = pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
    const y = H - pad - (v / max) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${(W - pad).toFixed(1)} ${(H - pad).toFixed(1)} L${pad} ${(H - pad).toFixed(1)} Z`;
  const gid = `spk-${color.replace("#", "")}`;
  const end = pts[pts.length - 1];
  return (
    <svg className="mt-1.5 block w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" height={30}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity={0.28} /><stop offset="1" stopColor={color} stopOpacity={0} />
      </linearGradient></defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {end && <circle cx={end[0]} cy={end[1]} r={2.6} fill={color} />}
    </svg>
  );
}

function maskAdmin(email: string | null): string {
  if (!email) return "—";
  const at = email.indexOf("@");
  return at <= 0 ? "•••" : `${email[0]}•••${email.slice(at)}`;
}

export default function AdminConsole({ initialRows, tiles, adminEmail }: {
  initialRows: Row[]; tiles: SummaryTiles; adminEmail: string | null;
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  useEffect(() => { setRows(initialRows); }, [initialRows]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<IdentitySort>("created");
  const [pill, setPill] = useState<null | "multi" | "locked" | "jailed" | "new24h" | "notRunHuman">(null);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(200);
  const [refs, setRefs] = useState<Record<string, RunHumanRef>>({});
  const [drawer, setDrawer] = useState<Detail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [reveal, setReveal] = useState(false); // admin-only panel (2 trusted admins) — reveal full emails

  // login-IP cache, keyed by userId so j/k stepping between identities in the
  // drawer doesn't refetch/clear (openDrawer resets `drawer` itself, so this
  // must live in separate state), plus the top-level reverse IP-lookup panel.
  const [loginIps, setLoginIps] = useState<Record<string, IpRow[]>>({});
  const [ipsPartial, setIpsPartial] = useState<Record<string, boolean>>({});

  const [lookupIp, setLookupIp] = useState("");
  const [lookupUsers, setLookupUsers] = useState<UserRow[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupPartial, setLookupPartial] = useState(false);

  const filtered = useMemo(() => {
    const nq = q.trim().toLowerCase();
    let out = [...rows];
    if (nq) {
      // Full client-side match on rabbit name, FULL email, and groups — the
      // client now holds emailFull, so search is instant and complete.
      out = out.filter((r) =>
        r.displayName.toLowerCase().includes(nq) ||
        (r.emailFull ?? "").toLowerCase().includes(nq) ||
        r.services.some((s) => s.toLowerCase().includes(nq)));
    }
    if (pill === "multi") out = out.filter((r) => r.providerCount > 1);
    if (pill === "locked") out = out.filter((r) => r.lockedOut);
    if (pill === "jailed") out = out.filter((r) => r.jailed);
    if (pill === "new24h") {
      const cut = Date.now() - 24 * 3600 * 1000;
      out = out.filter((r) => r.createdAt != null && r.createdAt >= cut);
    }
    if (pill === "notRunHuman") out = out.filter((r) => refs[r.userId] && !refs[r.userId].found);
    const cmp: Record<IdentitySort, (a: Row, b: Row) => number> = {
      created: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      providers: (a, b) => b.providerCount - a.providerCount,
      displayName: (a, b) => a.displayName.localeCompare(b.displayName),
    };
    return out.sort(cmp[sort]);
  }, [rows, q, pill, sort, refs]);

  const pageRows = filtered.slice(page * perPage, page * perPage + perPage);

  // Signup sparkline (last 14 days) from row timestamps.
  const spark = useMemo(() => {
    const days = 14, now = Date.now(), DAY = 864e5;
    const b = new Array(days).fill(0);
    for (const r of rows) {
      if (r.createdAt == null) continue;
      const d = Math.floor((now - r.createdAt) / DAY);
      if (d >= 0 && d < days) b[days - 1 - d]++;
    }
    return b;
  }, [rows]);

  // Lazily resolve run.human for the visible page.
  useEffect(() => {
    const need = pageRows.map((r) => r.userId).filter((id) => !(id in refs));
    if (need.length === 0) return;
    (async () => {
      const res = await fetch(`${BASE}/api/admin/identities/resolve-runhuman`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: need }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { refs: Record<string, RunHumanRef> };
      setRefs((prev) => ({ ...prev, ...data.refs }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, filtered.length, sort, pill, q]);

  async function openDrawer(userId: string) {
    setDrawerLoading(true); setDrawer(null);
    const res = await fetch(`${BASE}/api/admin/identities/${encodeURIComponent(userId)}`, { cache: "no-store" });
    setDrawerLoading(false);
    if (res.ok) setDrawer((await res.json()) as Detail);
  }

  // Lazily fetch login IPs when the drawer opens, caching by userId so j/k
  // stepping between identities (which calls openDrawer, resetting `drawer`)
  // doesn't refetch or drop already-loaded rows.
  useEffect(() => {
    const uid = drawer?.identity.userId;
    if (!uid || loginIps[uid]) return; // cached
    let cancelled = false;
    fetch(`${BASE}/api/admin/identities/${encodeURIComponent(uid)}/ips`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { ips: [] }))
      .then((d) => {
        if (cancelled) return;
        setLoginIps((m) => ({ ...m, [uid]: d.ips ?? [] }));
        setIpsPartial((m) => ({ ...m, [uid]: Boolean(d.partial) }));
      })
      .catch(() => { if (!cancelled) setLoginIps((m) => ({ ...m, [uid]: [] })); });
    return () => { cancelled = true; };
  }, [drawer?.identity.userId, loginIps]);

  // Reverse IP lookup, shared by the top-level panel input and clicking an IP
  // in the drawer's login-IPs list.
  async function runIpLookup(ip: string) {
    const v = ip.trim();
    setLookupIp(v);
    if (!v) { setLookupUsers(null); return; }
    setLookupLoading(true);
    setLookupPartial(false);
    try {
      const res = await fetch(`${BASE}/api/admin/ip-lookup?ip=${encodeURIComponent(v)}`, { cache: "no-store" });
      if (!res.ok) { setLookupUsers([]); return; }
      const d = await res.json();
      setLookupUsers(d.users ?? []);
      setLookupPartial(Boolean(d.partial));
    } catch {
      setLookupUsers([]);
    } finally {
      setLookupLoading(false);
    }
  }

  // Esc closes the drawer; j/k step to the next/prev identity in the current
  // filtered+sorted view while the drawer is open (skipped when typing in a
  // field), matching run.human's admin. Jumps the page so the row stays visible.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDrawer(null); setDrawerLoading(false); return; }
      if (!drawer || (e.key !== "j" && e.key !== "k")) return;
      const el = document.activeElement;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      const idx = filtered.findIndex((r) => r.userId === drawer.identity.userId);
      if (idx < 0) return;
      const next = Math.min(filtered.length - 1, Math.max(0, idx + (e.key === "j" ? 1 : -1)));
      if (next === idx) return;
      e.preventDefault();
      setPage(Math.floor(next / perPage));
      openDrawer(filtered[next].userId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, filtered, perPage]);

  const csvHref = `${BASE}/api/admin/identities?format=csv&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const heroes: { key: string; label: string; value: number; tint: string; Icon: Ico; note?: string; spark?: boolean }[] = [
    { key: "ids", label: "Identities", value: tiles.totalIdentities, tint: "#00d4aa", Icon: Users,
      note: "across GitHub · Discord · LinkedIn · email" },
    { key: "new", label: "New · 24h", value: tiles.new24h, tint: "#37c7e0", Icon: UserPlus, spark: true },
    { key: "mp", label: "Multi-provider", value: tiles.multiProvider, tint: "#9a7cff", Icon: Layers,
      note: "same email collapsed onto one identity" },
    { key: "lk", label: "Locked", value: tiles.locked, tint: "#f59e0b", Icon: Lock,
      note: tiles.locked === 0 ? "none locked out" : undefined },
    { key: "jl", label: "Jailed", value: tiles.jailed, tint: "#ff5c72", Icon: ShieldAlert,
      note: tiles.jailed === 0 ? "none jailed" : undefined },
  ];

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-museo text-[27px] font-extrabold tracking-tight">
            defcon<span className="text-primary">.</span>run 34 · Auth Identity Admin
          </h1>
          <p className="mt-1 text-[12.5px] text-default-500">
            Identity &amp; provider oversight · signed in as{" "}
            <span className="font-mono blur-[3px] transition-[filter] hover:blur-none">{maskAdmin(adminEmail)}</span>
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-divider bg-content1 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
          <span className="h-2 w-2 rounded-full bg-primary" style={{ boxShadow: "0 0 0 3px rgba(0,212,170,0.18)" }} />
          live
        </span>
      </header>

      {/* hero stat cards */}
      <section className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {heroes.map((h) => (
          <div key={h.key} className="relative overflow-hidden rounded-2xl border border-divider bg-content1 p-[18px]">
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: h.tint }} />
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-default-500">
              <h.Icon size={15} style={{ color: h.tint }} /> {h.label}
            </div>
            <div className="mt-2 font-mono text-[34px] font-bold leading-none tabular-nums">{h.value}</div>
            {h.spark && <Sparkline series={spark} color={h.tint} />}
            {h.note && <div className="mt-2 text-[11.5px] text-default-500">{h.note}</div>}
          </div>
        ))}
      </section>

      {/* IP lookup — reverse lookup, cross-linked with the drawer's login-IPs list */}
      <section className="mb-5 rounded-2xl border border-divider bg-content1 p-[18px]">
        <h2 className="mb-2 text-[12px] uppercase tracking-wide text-default-400">IP lookup <span className="text-default-300">· who logged in from an IP</span></h2>
        <div className="flex gap-2">
          <input
            value={lookupIp}
            onChange={(e) => setLookupIp(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runIpLookup(lookupIp); }}
            placeholder="paste an IP (IPv4 or IPv6)"
            className="flex-1 rounded-lg border border-divider bg-content1 px-3 py-2 text-[13px] outline-none focus:border-primary"
          />
          <button type="button" onClick={() => runIpLookup(lookupIp)} className="rounded-lg border border-divider px-3 py-2 text-[13px] hover:border-primary">Look up</button>
        </div>
        {lookupLoading ? (
          <p className="mt-2 text-[12px] text-default-400">Searching…</p>
        ) : lookupUsers === null ? null : lookupUsers.length === 0 ? (
          <>
            {lookupPartial && <p className="mt-2 text-[11px] text-warning">Partial results (query timed out).</p>}
            <p className="mt-2 text-[12px] text-default-400">No login events from this IP in the last 90 days.</p>
          </>
        ) : (
          <div className="mt-3">
            {lookupPartial && <p className="mb-1 text-[11px] text-warning">Partial results (query timed out).</p>}
            {lookupUsers.map((u) => (
              <div key={`${u.userId}:${u.email ?? ""}`} className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-divider p-2.5 text-[12.5px]">
                <button type="button" onClick={() => openDrawer(u.userId)} className="cursor-pointer text-primary hover:underline">
                  {u.email ?? u.userId}
                </button>
                <span className="text-default-500">{u.logins} logins</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* controls */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder="search rabbit or full email…"
          className="min-w-[220px] max-w-[340px] flex-1 rounded-lg border border-divider bg-content1 px-3 py-2 text-[13px] outline-none focus:border-primary" />
        <button onClick={() => setReveal((v) => !v)}
          className={`rounded-full border px-3 py-1.5 font-mono text-xs transition-colors ${
            reveal ? "border-primary bg-primary/10 text-primary" : "border-divider text-default-500 hover:text-foreground"}`}>
          {reveal ? "emails shown" : "reveal emails"}
        </button>
        {([["multi", "multi-provider"], ["locked", "locked"], ["jailed", "jailed"], ["new24h", "created <24h"], ["notRunHuman", "not in run.human"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setPill(pill === key ? null : key); setPage(0); }}
            className={`rounded-full border px-3 py-1.5 font-mono text-xs transition-colors ${
              pill === key ? "border-primary bg-primary/10 text-primary" : "border-divider text-default-500 hover:text-foreground"}`}>
            {label}
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as IdentitySort)}
          className="rounded-lg border border-divider bg-content1 px-2.5 py-2 text-[13px]">
          <option value="created">newest</option>
          <option value="providers">most providers</option>
          <option value="displayName">name A–Z</option>
        </select>
        <a href={csvHref}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90">
          Download CSV
        </a>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-2xl border border-divider bg-content1">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="bg-content2 text-left text-[11px] uppercase tracking-wide text-default-400">
                {["rabbit", "email", "providers", "last", "created", "run.human", "groups", ""].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const rh = refs[r.userId];
                const days = r.createdAt != null ? Math.floor((Date.now() - r.createdAt) / 864e5) : null;
                const recency = days == null ? "text-default-400" : days < 2 ? "text-primary" : days < 14 ? "text-warning" : "text-default-400";
                return (
                  <tr key={r.userId} className="cursor-pointer border-t border-divider hover:bg-content2" onClick={() => openDrawer(r.userId)}>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2.5 whitespace-nowrap">
                        <span className="grid h-7 w-7 flex-none place-items-center rounded-lg text-[11px] font-extrabold text-black"
                          style={{ background: avatarColor(r.userId) }}>
                          {r.displayName.replace(/^rabbit_/, "").slice(0, 2)}
                        </span>
                        <span className="font-semibold">{r.displayName}</span>
                        {r.lockedOut && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide text-warning">LOCKED</span>}
                        {r.jailed && <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide text-danger">JAILED L{r.jailLevel ?? 1}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`font-mono text-[11px] text-default-500 transition-[filter] ${reveal ? "" : "blur-[3px] hover:blur-none"}`}>{r.emailFull ?? r.emailMasked}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1.5">
                        {PROVIDER_ORDER.filter((p) => r.providers.includes(p)).map((p) => <ProviderChip key={p} p={p} />)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-default-500">{r.lastProvider ?? "—"}</td>
                    <td className={`px-3 py-2.5 font-mono text-[12px] ${recency}`}>
                      {days == null ? "—" : days === 0 ? "today" : `${days}d ago`}
                    </td>
                    <td className="px-3 py-2.5">
                      {rh == null ? <span className="text-default-300">…</span>
                        : rh.found ? <span className="font-mono text-[12px] text-success" title={rh.runUserId ?? ""}>✓</span>
                        : <span className="font-mono text-[13px] font-bold text-danger">✗</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1.5">{r.services.map((g) => <Tag key={g} g={g} />)}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-primary whitespace-nowrap">open →</td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-default-400">no identities match</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 border-t border-divider px-3 py-3 font-mono text-[12.5px] text-default-500">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">← prev</button>
          <span>page {page + 1} / {Math.max(1, Math.ceil(filtered.length / perPage))} · {filtered.length} rows</span>
          <button disabled={(page + 1) * perPage >= filtered.length} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">next →</button>
          <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}
            className="ml-auto rounded-md border border-divider bg-content2 px-2 py-1">
            {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
        </div>
      </div>

      {/* drawer */}
      {(drawer || drawerLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => { setDrawer(null); setDrawerLoading(false); }}>
          <div className="h-full w-full max-w-[430px] overflow-y-auto border-l border-divider bg-content1 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {drawerLoading && <p className="text-default-400">Loading…</p>}
            {drawer && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg text-[12px] font-extrabold text-black"
                      style={{ background: avatarColor(drawer.identity.userId) }}>
                      {drawer.identity.displayName.replace(/^rabbit_/, "").slice(0, 2)}
                    </span>
                    <h2 className="text-[17px] font-bold">{drawer.identity.displayName}</h2>
                    {drawer.identity.lockedOut && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[9.5px] font-extrabold text-warning">LOCKED</span>}
                    {drawer.identity.jailed && <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[9.5px] font-extrabold text-danger">JAILED L{drawer.identity.jailLevel ?? 1}</span>}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[10px] text-default-300">j/k · esc</span>
                    <button onClick={() => setDrawer(null)} className="text-default-400 hover:text-foreground">✕</button>
                  </div>
                </div>

                <div className="space-y-2 text-[13px]">
                  <div className="flex gap-2"><span className="min-w-[96px] text-default-400">email</span><span>{drawer.identity.email ?? "—"}</span></div>
                  <div className="flex gap-2"><span className="min-w-[96px] text-default-400">sub / userId</span><code className="font-mono text-[11.5px]">{drawer.identity.userId}</code></div>
                  <div className="flex gap-2"><span className="min-w-[96px] text-default-400">run.human</span>
                    <span>{drawer.runHuman.found
                      ? <span className="font-mono text-success">✓ {drawer.runHuman.displayName} · {drawer.runHuman.runUserId}</span>
                      : <span className="font-mono text-danger">✗ not found</span>}</span></div>
                  <div className="flex gap-2"><span className="min-w-[96px] text-default-400">groups</span>
                    <span className="flex flex-wrap gap-1.5">{drawer.identity.services.length ? drawer.identity.services.map((g) => <Tag key={g} g={g} />) : "—"}</span></div>
                  <div className="flex gap-2"><span className="min-w-[96px] text-default-400">sessionVersion</span>
                    <span className="tabular-nums">{drawer.identity.sessionVersion}
                      {drawer.identity.lockedOut && <span className="ml-2 text-warning">· {drawer.identity.lockoutReason}</span>}</span></div>
                </div>

                <div>
                  <h3 className="mb-2 text-[11px] uppercase tracking-wide text-default-400">linked accounts</h3>
                  {drawer.accounts.length === 0 && <p className="text-sm text-default-400">none</p>}
                  {drawer.accounts.map((a) => {
                    const meta = PROVIDER_META[a.provider as ProviderKey];
                    return (
                      <div key={`${a.provider}#${a.providerAccountId}`} className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-divider p-2.5 text-[12.5px]">
                        <span className="flex items-center gap-2">
                          {meta && <meta.Icon size={13} style={{ color: meta.color }} />}
                          <b style={{ color: meta?.color }}>{a.provider}</b>
                          <code className="font-mono text-[11.5px] text-default-500">{a.providerAccountId}</code>
                        </span>
                        <UnlinkAction userId={drawer.identity.userId} provider={a.provider} providerAccountId={a.providerAccountId}
                          onComplete={() => openDrawer(drawer.identity.userId)} />
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  // OIDC expiresAt is epoch SECONDS (oidc-adapter) — ×1000 for Date.
                  // "Live" = not yet expired; count the expired (TTL will purge them).
                  const now = Date.now();
                  const live = drawer.oidcSessions.filter((s) => s.expiresAt != null && s.expiresAt * 1000 > now);
                  const expired = drawer.oidcSessions.length - live.length;
                  return (
                    <div>
                      <h3 className="mb-2 text-[11px] uppercase tracking-wide text-default-400">
                        live SSO sessions{live.length > 0 && <span className="ml-1.5 normal-case tracking-normal text-default-500">({live.length})</span>}
                      </h3>
                      {live.length === 0 && <p className="text-sm text-default-400">none active</p>}
                      {live.map((s) => (
                        <div key={s.id} className="font-mono text-[11.5px] text-default-500">…{s.id.slice(-8)} · expires {new Date((s.expiresAt as number) * 1000).toLocaleString()}</div>
                      ))}
                      {expired > 0 && <p className="mt-1 text-[11px] text-default-300">+{expired} expired (auto-purged by TTL)</p>}
                    </div>
                  );
                })()}

                <div>
                  <h3 className="mb-2 text-[11px] uppercase tracking-wide text-default-400">
                    login IPs <span className="text-default-300">· last 90 days</span>
                  </h3>
                  {loginIps[drawer.identity.userId] === undefined ? (
                    <p className="text-[12px] text-default-400">Loading…</p>
                  ) : loginIps[drawer.identity.userId].length === 0 ? (
                    <p className="text-[12px] text-default-400">No login events in the last 90 days.</p>
                  ) : (
                    <>
                      {ipsPartial[drawer.identity.userId] && (
                        <p className="mb-1 text-[11px] text-warning">Partial results (query timed out).</p>
                      )}
                      {loginIps[drawer.identity.userId].map((r) => (
                        <div key={r.ip} className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-divider p-2.5 text-[12.5px]">
                          <button type="button" onClick={() => { runIpLookup(r.ip); setDrawer(null); }} className="cursor-pointer font-mono text-[11.5px] text-primary hover:underline" title="who else used this IP?">
                            {r.ip}
                          </button>
                          <span className="text-default-500">{r.logins} login{r.logins === 1 ? "" : "s"} · {r.agents} browser{r.agents === 1 ? "" : "s"}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-3 border-t border-divider pt-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-default-400">Enforcement</span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                      {drawer.identity.lockedOut ? (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <span className="h-1.5 w-1.5 rounded-full bg-danger" />Locked out{drawer.identity.lockoutReason ? ` · ${drawer.identity.lockoutReason}` : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-success">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />Active
                        </span>
                      )}
                      {drawer.identity.jailed && (
                        <span className="inline-flex items-center gap-1 text-warning">⛓ Jailed · L{drawer.identity.jailLevel ?? 1}</span>
                      )}
                    </div>
                  </div>
                  <LockAction userId={drawer.identity.userId} locked={drawer.identity.lockedOut}
                    onComplete={() => openDrawer(drawer.identity.userId)} />
                  <JailAction userId={drawer.identity.userId} jailed={drawer.identity.jailed} jailLevel={drawer.identity.jailLevel}
                    onComplete={() => openDrawer(drawer.identity.userId)} />
                  <DeleteIdentityAction userId={drawer.identity.userId} displayName={drawer.identity.displayName}
                    onComplete={() => setDrawer(null)} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
