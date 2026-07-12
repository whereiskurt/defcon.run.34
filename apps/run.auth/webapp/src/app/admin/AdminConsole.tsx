"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { IdentityRow, IdentitySort, SummaryTiles, ProviderKey } from "@/lib/identity-report";
import { LockAction, UnlinkAction, DeleteIdentityAction } from "./AdminActions";

type Row = Omit<IdentityRow, "emailFull">;
type RunHumanRef = { found: boolean; runUserId: string | null; displayName: string | null };
type Detail = {
  identity: { userId: string; displayName: string; email: string | null; services: string[];
    lastProvider: string | null; createdAt: number | null; lockedOut: boolean;
    lockoutReason: string | null; sessionVersion: number };
  accounts: { provider: string; providerAccountId: string; userId: string }[];
  oidcSessions: { id: string; expiresAt: number | null }[];
  runHuman: RunHumanRef;
};

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  github: "GH", discord: "DC", linkedin: "IN", strava: "ST", email: "EM",
};

function Chip({ p, on }: { p: ProviderKey; on: boolean }) {
  return (
    <span title={p} className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold mr-1 ${
      on ? "bg-primary/15 text-primary" : "bg-default-100 text-default-300"}`}>
      {PROVIDER_LABEL[p]}
    </span>
  );
}

const ALL_PROVIDERS: ProviderKey[] = ["github", "discord", "linkedin", "strava", "email"];

export default function AdminConsole({ initialRows, tiles, adminEmail }: {
  initialRows: Row[]; tiles: SummaryTiles; adminEmail: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialRows);
  useEffect(() => { setRows(initialRows); }, [initialRows]);
  const [q, setQ] = useState("");
  const [matchedIds, setMatchedIds] = useState<Set<string> | null>(null);
  const [sort, setSort] = useState<IdentitySort>("created");
  const [pill, setPill] = useState<null | "multi" | "locked" | "new24h" | "notRunHuman">(null);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [refs, setRefs] = useState<Record<string, RunHumanRef>>({});
  const [drawer, setDrawer] = useState<Detail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const searchSeq = useRef(0);

  // Server-side email search (debounced). Returns userIds only.
  useEffect(() => {
    if (!q.trim()) { searchSeq.current += 1; setMatchedIds(null); return; }
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/identities?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { rows: Row[] };
      if (seq === searchSeq.current) setMatchedIds(new Set(data.rows.map((r) => r.userId)));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => {
    let out = [...rows];
    if (matchedIds) out = out.filter((r) => matchedIds.has(r.userId));
    if (pill === "multi") out = out.filter((r) => r.providerCount > 1);
    if (pill === "locked") out = out.filter((r) => r.lockedOut);
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
  }, [rows, matchedIds, pill, sort, refs]);

  const pageRows = filtered.slice(page * perPage, page * perPage + perPage);

  // Lazily resolve run.human for the visible page.
  useEffect(() => {
    const need = pageRows.map((r) => r.userId).filter((id) => !(id in refs));
    if (need.length === 0) return;
    (async () => {
      const res = await fetch(`/api/admin/identities/resolve-runhuman`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: need }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { refs: Record<string, RunHumanRef> };
      setRefs((prev) => ({ ...prev, ...data.refs }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, filtered.length, sort, pill, matchedIds]);

  async function openDrawer(userId: string) {
    setDrawerLoading(true); setDrawer(null);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}`, { cache: "no-store" });
    setDrawerLoading(false);
    if (res.ok) setDrawer((await res.json()) as Detail);
  }

  const csvHref = `/api/admin/identities?format=csv&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-museo text-2xl font-bold">defcon.run 34 · Auth Identity Admin<span className="text-primary">.</span></h1>
        <span className="text-default-400 text-sm">signed in as {adminEmail}</span>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Identities", tiles.totalIdentities], ["New 24h", tiles.new24h],
           ["Multi-provider", tiles.multiProvider], ["Locked", tiles.locked]] as const).map(([label, n]) => (
          <div key={label} className="rounded-xl border border-divider bg-content1 p-4">
            <div className="text-default-400 text-xs uppercase tracking-wide">{label}</div>
            <div className="text-2xl font-bold">{n}</div>
          </div>
        ))}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder="search full email…"
          className="rounded-md border border-default-300 bg-content1 px-3 py-1.5 text-sm" />
        {([["multi", "multi-provider"], ["locked", "locked"], ["new24h", "created <24h"], ["notRunHuman", "not in run.human"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setPill(pill === key ? null : key); setPage(0); }}
            className={`rounded-full px-3 py-1 text-xs border ${pill === key ? "bg-primary/15 border-primary text-primary" : "border-default-300 text-default-500"}`}>
            {label}
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as IdentitySort)}
          className="rounded-md border border-default-300 bg-content1 px-2 py-1.5 text-sm">
          <option value="created">newest</option>
          <option value="providers">most providers</option>
          <option value="displayName">name A–Z</option>
        </select>
        <a href={csvHref} className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Download CSV</a>
      </div>

      <div className="overflow-x-auto rounded-xl border border-divider">
        <table className="w-full text-sm">
          <thead className="bg-content2 text-left text-default-500">
            <tr>
              <th className="px-3 py-2">rabbit</th><th className="px-3 py-2">email</th>
              <th className="px-3 py-2">providers</th><th className="px-3 py-2">last</th>
              <th className="px-3 py-2">created</th><th className="px-3 py-2">run.human</th>
              <th className="px-3 py-2">groups</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const rh = refs[r.userId];
              return (
                <tr key={r.userId} className="border-t border-divider hover:bg-content2/40 cursor-pointer" onClick={() => openDrawer(r.userId)}>
                  <td className="px-3 py-2 font-medium">{r.displayName}{r.lockedOut && <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning">LOCKED</span>}</td>
                  <td className="px-3 py-2"><span className="blur-[3px] hover:blur-none transition">{r.emailMasked}</span></td>
                  <td className="px-3 py-2">{ALL_PROVIDERS.map((p) => <Chip key={p} p={p} on={r.providers.includes(p)} />)}</td>
                  <td className="px-3 py-2 text-default-400">{r.lastProvider ?? "—"}</td>
                  <td className="px-3 py-2 text-default-400">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2">{rh == null ? <span className="text-default-300">…</span> : rh.found ? <span className="text-success" title={rh.runUserId ?? ""}>✓ {rh.displayName}</span> : <span className="text-danger">✗</span>}</td>
                  <td className="px-3 py-2 text-default-400">{r.services.join(", ")}</td>
                  <td className="px-3 py-2 text-primary">open →</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm text-default-500">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">← prev</button>
        <span>page {page + 1} / {Math.max(1, Math.ceil(filtered.length / perPage))} · {filtered.length} rows</span>
        <button disabled={(page + 1) * perPage >= filtered.length} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">next →</button>
        <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }} className="ml-auto rounded-md border border-default-300 bg-content1 px-2 py-1">
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>

      {(drawer || drawerLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => { setDrawer(null); setDrawerLoading(false); }}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-content1 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {drawerLoading && <p className="text-default-400">Loading…</p>}
            {drawer && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">{drawer.identity.displayName}</h2>
                  <button onClick={() => setDrawer(null)} className="text-default-400">✕</button>
                </div>
                <div className="text-sm"><span className="text-default-400">email:</span> {drawer.identity.email ?? "—"}</div>
                <div className="text-sm"><span className="text-default-400">sub / userId:</span> <code className="font-mono text-xs">{drawer.identity.userId}</code></div>
                <div className="text-sm"><span className="text-default-400">run.human:</span> {drawer.runHuman.found ? `✓ ${drawer.runHuman.displayName} (${drawer.runHuman.runUserId})` : "✗ not found"}</div>
                <div className="text-sm"><span className="text-default-400">groups:</span> {drawer.identity.services.join(", ") || "—"}</div>
                <div className="text-sm"><span className="text-default-400">sessionVersion:</span> {drawer.identity.sessionVersion}{drawer.identity.lockedOut && <span className="ml-2 text-warning">LOCKED · {drawer.identity.lockoutReason}</span>}</div>

                <div>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-default-400">linked accounts</h3>
                  {drawer.accounts.length === 0 && <p className="text-sm text-default-400">none</p>}
                  {drawer.accounts.map((a) => (
                    <div key={`${a.provider}#${a.providerAccountId}`} className="mb-2 flex items-center justify-between rounded-md border border-divider p-2 text-sm">
                      <span>{a.provider} · <code className="font-mono text-xs">{a.providerAccountId}</code></span>
                      <UnlinkAction userId={drawer.identity.userId} provider={a.provider} providerAccountId={a.providerAccountId}
                        onComplete={() => openDrawer(drawer.identity.userId)} />
                    </div>
                  ))}
                </div>

                <div>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-default-400">live SSO sessions</h3>
                  {drawer.oidcSessions.length === 0 && <p className="text-sm text-default-400">none</p>}
                  {drawer.oidcSessions.map((s) => (
                    <div key={s.id} className="text-xs text-default-500">…{s.id.slice(-8)} · expires {s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "—"}</div>
                  ))}
                </div>

                <div className="space-y-3 border-t border-divider pt-3">
                  <LockAction userId={drawer.identity.userId} locked={drawer.identity.lockedOut}
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
