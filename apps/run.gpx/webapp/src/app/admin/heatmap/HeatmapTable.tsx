"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApiUrl } from "@/lib/admin-api-base";
import { reconcileHeatmap, type RunShape } from "@/lib/heatmap-shape";
import RunRow from "./RunRow";
import ShapeThumb from "./ShapeThumb";
import type { HeatmapRun, ShapeMap } from "./types";

/**
 * Moderation table for the public heat map.
 *
 * Hide/Delete mutate only the source rows. The public map keeps serving the
 * prebuilt artifact until Regenerate runs, so `pendingChanges` tracks how many
 * moderation actions are waiting and the button says so.
 *
 * TWO REQUESTS, NOT ONE. The roster paints the table immediately; the shape
 * geometry (~300 GPX reads out of S3) arrives on a second request and fills the
 * thumbnails in. Folding them together would put every one of those reads in
 * front of first paint on the page an admin reaches for when something is
 * already wrong.
 */
export default function HeatmapTable() {
  const [runs, setRuns] = useState<HeatmapRun[]>([]);
  const [shapes, setShapes] = useState<ShapeMap>({});
  const [failedShapes, setFailedShapes] = useState<Set<string>>(new Set());
  const [shapesLoading, setShapesLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [artifactRunCount, setArtifactRunCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ shape: RunShape; run: HeatmapRun } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(adminApiUrl("/api/gpx/admin/heatmap"), {
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

  /**
   * Shapes are best-effort: a failure here leaves the table fully usable with
   * empty thumbnails. It must never surface as the page's error banner, which
   * is reserved for moderation actions that actually failed.
   */
  const loadShapes = useCallback(async () => {
    setShapesLoading(true);
    try {
      const res = await fetch(adminApiUrl("/api/gpx/admin/heatmap/shapes"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`shapes ${res.status}`);
      const data = await res.json();
      setShapes(data.shapes ?? {});
      setFailedShapes(new Set<string>(data.failed ?? []));
    } catch (e) {
      console.error("[admin/heatmap] shapes:", e);
    } finally {
      setShapesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadShapes();
  }, [load, loadShapes]);

  async function toggleHidden(r: HeatmapRun) {
    setBusy(r.fileId);
    setError(null);
    try {
      const res = await fetch(
        adminApiUrl(`/api/gpx/admin/heatmap/${encodeURIComponent(r.fileId)}`),
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
        adminApiUrl(`/api/gpx/admin/heatmap/${encodeURIComponent(r.fileId)}?userId=${encodeURIComponent(r.userId)}`),
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
      const res = await fetch(adminApiUrl("/api/gpx/admin/heatmap/rebuild"), {
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

  const flaggedCount = runs.filter(
    (r) => (shapes[r.fileId]?.signals.length ?? 0) > 0
  ).length;

  // Roster count vs published count, with the difference named. Only meaningful
  // once the shapes request has settled — see reconcileHeatmap.
  const tally = reconcileHeatmap(runs, shapes, failedShapes);
  const artifactIsStale =
    !shapesLoading &&
    tally.expectedOnMap !== null &&
    artifactRunCount !== null &&
    artifactRunCount !== tally.expectedOnMap;

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
            <strong>{tally.total}</strong> con-day runs · <strong>{tally.hidden}</strong>{" "}
            hidden
            {!shapesLoading && (
              <>
                {" "}
                ·{" "}
                <span title="Treadmill and distance-only imports — the stored GPX has no trackpoints, so there is no line to draw. They still count for distance and the leaderboard.">
                  <strong>{tally.trackless}</strong> trackless
                </span>{" "}
                · <strong>{flaggedCount}</strong> flagged
              </>
            )}
          </div>
          {!shapesLoading && tally.expectedOnMap !== null && (
            <div style={{ color: "#666" }}>
              → <strong>{tally.expectedOnMap}</strong> should draw on the map
            </div>
          )}
          <div style={{ color: "#666" }}>
            Published artifact:{" "}
            {generatedAt
              ? `${artifactRunCount ?? "?"} runs, built ${new Date(generatedAt).toLocaleString()}`
              : "never built"}
          </div>
          {artifactIsStale && (
            <div style={{ color: "#8a6100" }}>
              Artifact is {artifactRunCount} — {tally.expectedOnMap} expected. It
              rebuilds hourly; Regenerate publishes now.
            </div>
          )}
          {shapesLoading && (
            <div style={{ color: "#666" }}>Reading run geometry…</div>
          )}
          {!shapesLoading && failedShapes.size > 0 && (
            <div style={{ color: "#b00" }}>
              {failedShapes.size} run{failedShapes.size === 1 ? "" : "s"} could not
              be read from S3 — shown as “!”.
            </div>
          )}
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
              <th style={{ padding: "0.4rem", width: 70 }}>Shape</th>
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
              <RunRow
                key={`${r.userId}:${r.fileId}`}
                run={r}
                shape={shapes[r.fileId]}
                shapesLoading={shapesLoading}
                shapeFailed={failedShapes.has(r.fileId)}
                busy={busy === r.fileId}
                onToggleHidden={() => void toggleHidden(r)}
                onDelete={() => void remove(r)}
                onEnlarge={(shape, run) => setZoom({ shape, run })}
              />
            ))}
          </tbody>
        </table>
      )}

      {zoom && <ZoomOverlay zoom={zoom} onClose={() => setZoom(null)} />}
    </>
  );
}

/** Click-to-enlarge. Escape or a backdrop click closes it. */
function ZoomOverlay({
  zoom,
  onClose,
}: {
  zoom: { shape: RunShape; run: HeatmapRun };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "1rem",
          maxWidth: "min(90vw, 520px)",
        }}
      >
        <div style={{ marginBottom: "0.5rem", wordBreak: "break-word" }}>
          <strong>{zoom.run.fileName}</strong>
        </div>
        <ShapeThumb shape={zoom.shape} size={380} />
        <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#666" }}>
          {zoom.shape.points} points · {zoom.shape.spanMeters} m across ·{" "}
          {zoom.run.conDay ?? "no con-day"}
        </div>
        <button
          onClick={onClose}
          style={{ marginTop: "0.75rem", padding: "0.35rem 0.8rem", cursor: "pointer" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
