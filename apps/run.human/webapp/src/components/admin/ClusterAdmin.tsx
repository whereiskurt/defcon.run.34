"use client";

import { Fragment, useState } from "react";
import { cls } from "@/components/admin/qr-ui";
import { apiUrl } from "@/lib/api";
import type { ClusterConfig, ClusterTier } from "@/lib/cluster-config";

/**
 * /admin/clusters control panel.
 *
 * Knobs + a dry-run preview + the real sweep + demo data load/clear. Preview
 * and sweep hit the SAME endpoint with a `dryRun` flag, so the table the
 * preview renders is exactly what a sweep would write.
 *
 * ── basePath landmine ───────────────────────────────────────────────────────
 * Next.js `basePath` (/use1) does NOT apply to client-side `fetch("/api/...")`
 * — a bare path 404s against the origin in prod while the page still renders.
 * Every call below goes through `apiUrl()`.
 */

type SweepCluster = {
  clusterId: string;
  day: string;
  startAt: number;
  endAt: number;
  size: number;
  points: number;
  centroidLat: number;
  centroidLng: number;
  members: { userId: string; displayName: string }[];
};

type SweepResponse = {
  enabled: boolean;
  dryRun: boolean;
  scannedCheckIns: number;
  written: number;
  deleted: number;
  rescored: number;
  rescoreFailed: number;
  totalAwarded: number;
  clusters: SweepCluster[];
};

function fmtTime(epochMs: number): string {
  // Con-local (PDT = UTC-7).
  const d = new Date(epochMs - 7 * 3_600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function fmtDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${day.slice(5)}`;
}

export default function ClusterAdmin({ initial }: { initial: ClusterConfig }) {
  const [cfg, setCfg] = useState<ClusterConfig>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sweep, setSweep] = useState<SweepResponse | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const num = (k: keyof ClusterConfig) => (v: string) =>
    setCfg((c) => ({ ...c, [k]: v === "" ? 0 : Number(v) }));

  const setTier = (i: number, patch: Partial<ClusterTier>) =>
    setCfg((c) => ({
      ...c,
      tiers: c.tiers.map((t, n) => (n === i ? { ...t, ...patch } : t)),
    }));

  async function call<T>(
    label: string,
    path: string,
    init: RequestInit,
  ): Promise<T | null> {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(apiUrl(path), {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
      });
      if (!res.ok) {
        setError(`${label} failed (HTTP ${res.status})`);
        return null;
      }
      return (await res.json()) as T;
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const saved = await call<ClusterConfig>("Save", "/api/admin/clusters/config", {
      method: "PUT",
      body: JSON.stringify(cfg),
    });
    if (saved) {
      setCfg(saved);
      setNote("Config saved. Values are clamped server-side; the table above shows what stuck.");
    }
  }

  async function runSweep(dryRun: boolean) {
    const result = await call<SweepResponse>(
      dryRun ? "Preview" : "Sweep",
      "/api/admin/clusters/sweep",
      { method: "POST", body: JSON.stringify({ dryRun }) },
    );
    if (result) {
      setSweep(result);
      setNote(
        dryRun
          ? `Preview only — nothing written. ${result.clusters.length} clusters over ${result.scannedCheckIns} check-ins.`
          : `Swept: ${result.written} awards written, ${result.deleted} removed, ${result.rescored} runners rescored.`,
      );
    }
  }

  async function demo(action: "load" | "clear") {
    const result = await call<Record<string, number | string>>(
      action === "load" ? "Load demo" : "Clear demo",
      "/api/admin/clusters/demo",
      { method: "POST", body: JSON.stringify({ action }) },
    );
    if (result) {
      setNote(
        action === "load"
          ? `Demo loaded: ${result.runners} runners, ${result.checkIns} check-ins, ${result.clusters} clusters, ${result.awardsWritten} awards.`
          : `Demo cleared: ${result.runners} runners, ${result.checkIns} check-ins, ${result.awards} awards, ${result.accomplishments} accomplishments removed.`,
      );
      if (action === "clear") setSweep(null);
      else await runSweep(true);
    }
  }

  return (
    <div className={cls.root}>
      {/* ── Config ─────────────────────────────────────────────────────────── */}
      <section className={cls.cardPad}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={cls.h2}>Cluster bonuses</h2>
          <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))}
              className="w-4 h-4 accent-primary"
            />
            {cfg.enabled ? "Enabled" : "Disabled"}
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={cls.label}>Radius (m)</label>
            <input
              className={cls.input}
              type="number"
              value={cfg.radiusMeters}
              onChange={(e) => num("radiusMeters")(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>Window (min)</label>
            <input
              className={cls.input}
              type="number"
              value={cfg.windowMinutes}
              onChange={(e) => num("windowMinutes")(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>Min runners</label>
            <input
              className={cls.input}
              type="number"
              value={cfg.minRunners}
              onChange={(e) => num("minRunners")(e.target.value)}
            />
          </div>
          <div>
            <label className={cls.label}>Max awards / runner / day</label>
            <input
              className={cls.input}
              type="number"
              value={cfg.maxPerUserPerDay}
              onChange={(e) => num("maxPerUserPerDay")(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className={cls.label}>Tier table — points each member earns</label>
          <div className="flex flex-col gap-2">
            {cfg.tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[12px] text-default-400 w-10">&ge;</span>
                <input
                  className={`${cls.input} w-24`}
                  type="number"
                  value={t.minRunners}
                  onChange={(e) => setTier(i, { minRunners: Number(e.target.value) })}
                />
                <span className="text-[12px] text-default-400">runners &rarr;</span>
                <input
                  className={`${cls.input} w-24`}
                  type="number"
                  value={t.points}
                  onChange={(e) => setTier(i, { points: Number(e.target.value) })}
                />
                <span className="text-[12px] text-default-400">pts</span>
                <button
                  className={cls.btn}
                  onClick={() =>
                    setCfg((c) => ({ ...c, tiers: c.tiers.filter((_, n) => n !== i) }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div>
              <button
                className={cls.btn}
                onClick={() =>
                  setCfg((c) => ({
                    ...c,
                    tiers: [
                      ...c.tiers,
                      {
                        minRunners:
                          (c.tiers[c.tiers.length - 1]?.minRunners ?? 0) + 5,
                        points: (c.tiers[c.tiers.length - 1]?.points ?? 0) + 25,
                      },
                    ],
                  }))
                }
              >
                + Add tier
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          <button className={cls.btnPrimary} disabled={!!busy} onClick={save}>
            {busy === "Save" ? "Saving…" : "Save config"}
          </button>
          <button className={cls.btn} disabled={!!busy} onClick={() => runSweep(true)}>
            {busy === "Preview" ? "Previewing…" : "Preview (dry run)"}
          </button>
          <button className={cls.btnPrimary} disabled={!!busy} onClick={() => runSweep(false)}>
            {busy === "Sweep" ? "Sweeping…" : "Sweep + award"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-divider">
          <button className={cls.btn} disabled={!!busy} onClick={() => demo("load")}>
            {busy === "Load demo" ? "Loading…" : "Load demo clusters"}
          </button>
          <button className={cls.btnDanger} disabled={!!busy} onClick={() => demo("clear")}>
            {busy === "Clear demo" ? "Clearing…" : "Clear demo clusters"}
          </button>
          <span className={`${cls.sub} self-center`}>
            Demo runners are seeded onto con days and removed from an explicit manifest.
          </span>
        </div>

        {error && (
          <p className="mt-3 text-[13px] text-danger font-semibold">{error}</p>
        )}
        {note && !error && <p className={`mt-3 text-[13px] ${cls.sub}`}>{note}</p>}
      </section>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {sweep && (
        <section className={cls.card}>
          <div className="flex flex-wrap items-baseline gap-4 px-4 py-3 border-b border-divider">
            <h2 className={cls.h2}>
              {sweep.dryRun ? "Preview" : "Swept"} — {sweep.clusters.length} clusters
            </h2>
            <span className={cls.sub}>
              {sweep.scannedCheckIns} check-ins scanned · {sweep.totalAwarded} points
              awarded in total
              {!sweep.dryRun && ` · ${sweep.rescored} runners rescored`}
              {sweep.rescoreFailed > 0 && ` · ${sweep.rescoreFailed} rescore failures`}
            </span>
            {!sweep.enabled && (
              <span className="text-[13px] text-danger font-semibold">
                Cluster bonuses are DISABLED — nothing was detected.
              </span>
            )}
          </div>

          {sweep.clusters.length === 0 ? (
            <p className={`${cls.sub} px-4 py-6`}>
              No clusters found. Check the radius/window/min-runners knobs, or load
              the demo data.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className={cls.table}>
                <thead className={cls.thead}>
                  <tr>
                    <th className={cls.th}>Day</th>
                    <th className={cls.th}>Time</th>
                    <th className={cls.th}>Where</th>
                    <th className={cls.th}>Runners</th>
                    <th className={cls.th}>Each</th>
                    <th className={cls.th}>Total</th>
                    <th className={cls.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {sweep.clusters.map((c) => (
                    <Fragment key={c.clusterId}>
                      <tr className={cls.tr}>
                        <td className={cls.td}>{fmtDay(c.day)}</td>
                        <td className={cls.td}>
                          {fmtTime(c.startAt)}–{fmtTime(c.endAt)}
                        </td>
                        <td className={cls.td}>
                          <a
                            className="text-primary hover:underline"
                            href={`https://www.google.com/maps?q=${c.centroidLat.toFixed(5)},${c.centroidLng.toFixed(5)}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {c.centroidLat.toFixed(4)}, {c.centroidLng.toFixed(4)}
                          </a>
                        </td>
                        <td className={cls.td}>{c.size}</td>
                        <td className={cls.td}>{c.points}</td>
                        <td className={cls.td}>{c.points * c.size}</td>
                        <td className={cls.td}>
                          <button
                            className="text-primary hover:underline"
                            onClick={() =>
                              setExpanded(expanded === c.clusterId ? null : c.clusterId)
                            }
                          >
                            {expanded === c.clusterId ? "hide" : "who"}
                          </button>
                        </td>
                      </tr>
                      {expanded === c.clusterId && (
                        <tr className="border-t border-divider">
                          <td className={`${cls.td} whitespace-normal`} colSpan={7}>
                            <span className="text-default-400">members: </span>
                            {c.members.map((m) => m.displayName).join(", ")}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
