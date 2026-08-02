"use client";

import { useCallback, useEffect, useState } from "react";

type HeatmapRun = {
  fileId: string;
  userId: string;
  fileName: string;
  conDay?: string;
  totalDistance?: number;
  trackCount?: number;
  source?: string;
  createdAt: number;
  hidden: boolean;
};

/**
 * Moderation table for the public heat map. All values render as JSX text nodes
 * (auto-escaped) — never dangerouslySetInnerHTML: file names are user input and
 * the whole point of this screen is that some of them are hostile.
 *
 * Hide/Delete mutate only the source rows. The public map keeps serving the
 * prebuilt artifact until Regenerate runs, so `pendingChanges` tracks how many
 * moderation actions are waiting and the button says so.
 */
export default function HeatmapTable() {
  const [runs, setRuns] = useState<HeatmapRun[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [artifactRunCount, setArtifactRunCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gpx/admin/heatmap", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setRuns(data.runs ?? []);
      setGeneratedAt(data.artifactGeneratedAt ?? null);
      setArtifactRunCount(data.artifactRunCount ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleHidden(r: HeatmapRun) {
    setBusy(r.fileId);
    setError(null);
    try {
      const res = await fetch(
        `/api/gpx/admin/heatmap/${encodeURIComponent(r.fileId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ userId: r.userId, hidden: !r.hidden }),
        }
      );
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      setPendingChanges((n) => n + 1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: HeatmapRun) {
    if (
      !window.confirm(
        `Delete "${r.fileName}" permanently?\n\nThis removes the runner's run, its file, and its leaderboard credit. Hide is reversible — use that unless you mean to destroy it.`
      )
    )
      return;
    setBusy(r.fileId);
    setError(null);
    try {
      const res = await fetch(
        `/api/gpx/admin/heatmap/${encodeURIComponent(r.fileId)}?userId=${encodeURIComponent(r.userId)}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      setPendingChanges((n) => n + 1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    setRebuilding(true);
    setError(null);
    setRebuildMsg(null);
    try {
      const res = await fetch("/api/gpx/admin/heatmap/rebuild", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Rebuild failed (${res.status})`);
      const data = await res.json();
      setRebuildMsg(
        `Rebuilt — ${data.runCount} runs, ${Math.round(data.totalKm ?? 0)} km. Now live.`
      );
      setPendingChanges(0);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  const hiddenCount = runs.filter((r) => r.hidden).length;

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
          padding: "0.75rem",
          marginBottom: "1rem",
          background: pendingChanges > 0 ? "#fff4e5" : "#f6f6f6",
          border: `1px solid ${pendingChanges > 0 ? "#e0a800" : "#ddd"}`,
          borderRadius: 6,
        }}
      >
        <div style={{ flex: 1, minWidth: 260, fontSize: "0.9rem" }}>
          <div>
            <strong>{runs.length}</strong> con-day runs · <strong>{hiddenCount}</strong>{" "}
            hidden
          </div>
          <div style={{ color: "#666" }}>
            Published artifact:{" "}
            {generatedAt
              ? `${artifactRunCount ?? "?"} runs, built ${new Date(generatedAt).toLocaleString()}`
              : "never built"}
          </div>
          {pendingChanges > 0 && (
            <div style={{ color: "#8a6100", fontWeight: 600 }}>
              {pendingChanges} change{pendingChanges === 1 ? "" : "s"} not yet
              published — press Regenerate.
            </div>
          )}
        </div>
        <button
          onClick={() => void regenerate()}
          disabled={rebuilding}
          style={{
            padding: "0.5rem 1rem",
            cursor: rebuilding ? "wait" : "pointer",
            fontWeight: 600,
            color: "#fff",
            background: pendingChanges > 0 ? "#b06a00" : "#333",
            border: "none",
            borderRadius: 6,
          }}
        >
          {rebuilding ? "Regenerating… (up to 4 min)" : "Regenerate heat map"}
        </button>
      </div>

      {rebuildMsg && (
        <p style={{ color: "#0a7", marginBottom: "0.75rem" }}>{rebuildMsg}</p>
      )}
      {error && <p style={{ color: "#b00", marginBottom: "0.75rem" }}>{error}</p>}

      {runs.length === 0 ? (
        <p>No con-day runs yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
              <th style={{ padding: "0.4rem" }}>Run</th>
              <th style={{ padding: "0.4rem" }}>Owner</th>
              <th style={{ padding: "0.4rem" }}>Day</th>
              <th style={{ padding: "0.4rem" }}>Distance</th>
              <th style={{ padding: "0.4rem" }}>Source</th>
              <th style={{ padding: "0.4rem" }}>State</th>
              <th style={{ padding: "0.4rem" }}></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={`${r.userId}:${r.fileId}`}
                style={{
                  borderBottom: "1px solid #eee",
                  opacity: r.hidden ? 0.55 : 1,
                }}
              >
                <td style={{ padding: "0.4rem" }}>{r.fileName}</td>
                <td
                  style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#666" }}
                >
                  {r.userId}
                </td>
                <td style={{ padding: "0.4rem" }}>{r.conDay ?? "—"}</td>
                <td style={{ padding: "0.4rem" }}>
                  {r.totalDistance
                    ? `${(r.totalDistance / 1000).toFixed(1)} km`
                    : "—"}
                </td>
                <td style={{ padding: "0.4rem" }}>{r.source ?? "—"}</td>
                <td style={{ padding: "0.4rem" }}>
                  {r.hidden ? (
                    <span style={{ color: "#b06a00", fontWeight: 600 }}>
                      Hidden
                    </span>
                  ) : (
                    "On map"
                  )}
                </td>
                <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => void toggleHidden(r)}
                    disabled={busy === r.fileId}
                    style={{ padding: "0.25rem 0.6rem", cursor: "pointer" }}
                  >
                    {busy === r.fileId ? "…" : r.hidden ? "Unhide" : "Hide"}
                  </button>
                  <button
                    onClick={() => void remove(r)}
                    disabled={busy === r.fileId}
                    style={{
                      padding: "0.25rem 0.6rem",
                      marginLeft: "0.35rem",
                      cursor: "pointer",
                      color: "#fff",
                      background: "#b00",
                      border: "1px solid #900",
                      borderRadius: 4,
                    }}
                  >
                    {busy === r.fileId ? "…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
