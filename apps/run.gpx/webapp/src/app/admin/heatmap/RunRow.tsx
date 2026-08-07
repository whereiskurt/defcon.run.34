"use client";

import { useState } from "react";
import type { RunShape } from "@/lib/heatmap-shape";
import { SIGNAL_META } from "@/lib/heatmap-shape";
import { adminApiUrl } from "@/lib/admin-api-base";
import ShapeThumb from "./ShapeThumb";
import { SOURCE_COLOR, type HeatmapRun, type StravaPayload } from "./types";

const cell: React.CSSProperties = { padding: "0.5rem 0.4rem", verticalAlign: "top" };

/**
 * One moderation row.
 *
 * EVERY user-supplied value here renders as a JSX text node — file names,
 * display names, and the Strava payload alike. Never dangerouslySetInnerHTML:
 * the whole point of this screen is that some of these values are hostile.
 */
export default function RunRow({
  run,
  shape,
  shapesLoading,
  shapeFailed,
  busy,
  onToggleHidden,
  onDelete,
  onEnlarge,
}: {
  run: HeatmapRun;
  shape?: RunShape;
  shapesLoading: boolean;
  shapeFailed: boolean;
  busy: boolean;
  onToggleHidden: () => void;
  onDelete: () => void;
  onEnlarge: (shape: RunShape, run: HeatmapRun) => void;
}) {
  const [payload, setPayload] = useState<StravaPayload | null>(null);
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  async function toggleStrava() {
    if (payloadOpen) {
      setPayloadOpen(false);
      return;
    }
    setPayloadOpen(true);
    if (payload) return; // already fetched — the snapshot does not change under us
    setPayloadLoading(true);
    setPayloadError(null);
    try {
      const res = await fetch(
        adminApiUrl(
          `/api/gpx/admin/heatmap/${encodeURIComponent(run.fileId)}/strava?userId=${encodeURIComponent(run.userId)}`
        ),
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setPayload(await res.json());
    } catch (e) {
      setPayloadError(e instanceof Error ? e.message : "Failed to load payload");
    } finally {
      setPayloadLoading(false);
    }
  }

  const owner = run.owner;

  return (
    <>
      <tr
        style={{
          borderBottom: payloadOpen ? "none" : "1px solid #eee",
          opacity: run.hidden ? 0.55 : 1,
        }}
      >
        <td style={cell}>
          <ShapeThumb
            shape={shape}
            loading={shapesLoading && !shape && !shapeFailed}
            failed={shapeFailed}
            onClick={shape?.path ? () => onEnlarge(shape, run) : undefined}
          />
        </td>

        <td style={cell}>
          <div style={{ wordBreak: "break-word" }}>{run.fileName}</div>
          {shape && (
            <div style={{ fontSize: "0.7rem", color: "#888", marginTop: 2 }}>
              {shape.points} pts · {shape.spanMeters} m across
            </div>
          )}
          {shape && shape.signals.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
              {shape.signals.map((s) => (
                <span
                  key={s}
                  title={SIGNAL_META[s].title}
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    padding: "0.1rem 0.35rem",
                    borderRadius: 3,
                    color: SIGNAL_META[s].color,
                    border: `1px solid ${SIGNAL_META[s].color}`,
                    background: "#fff",
                    cursor: "help",
                  }}
                >
                  ⚠ {SIGNAL_META[s].label}
                </span>
              ))}
            </div>
          )}
        </td>

        <td style={cell}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Avatar owner={owner} userId={run.userId} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "0.85rem" }}>
                {owner?.displayName ?? (
                  <span style={{ color: "#999" }}>unresolved</span>
                )}
              </div>
              <div
                style={{ fontSize: "0.65rem", color: "#888", fontFamily: "monospace" }}
                title={run.userId}
              >
                {run.userId.slice(0, 8)}
              </div>
            </div>
          </div>
        </td>

        <td style={cell}>{run.conDay ?? "—"}</td>
        <td style={cell}>
          {run.totalDistance ? `${(run.totalDistance / 1000).toFixed(1)} km` : "—"}
        </td>

        <td style={cell}>
          {run.source ? (
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                padding: "0.1rem 0.35rem",
                borderRadius: 3,
                color: SOURCE_COLOR[run.source] ?? "#6b7280",
                border: `1px solid ${SOURCE_COLOR[run.source] ?? "#6b7280"}`,
              }}
            >
              {run.source}
            </span>
          ) : (
            "—"
          )}
          {run.stravaActivityId && (
            <div style={{ marginTop: 4 }}>
              <button
                onClick={() => void toggleStrava()}
                style={{
                  fontSize: "0.65rem",
                  padding: "0.1rem 0.35rem",
                  cursor: "pointer",
                  border: "1px solid #ccc",
                  borderRadius: 3,
                  background: payloadOpen ? "#eee" : "#fff",
                }}
              >
                {payloadOpen ? "hide raw" : "⟨ raw ⟩"}
              </button>
            </div>
          )}
        </td>

        <td style={cell}>
          {run.hidden ? (
            <span style={{ color: "#b06a00", fontWeight: 600 }}>Hidden</span>
          ) : (
            "On map"
          )}
        </td>

        <td style={{ ...cell, whiteSpace: "nowrap" }}>
          <button
            onClick={onToggleHidden}
            disabled={busy}
            style={{ padding: "0.25rem 0.6rem", cursor: "pointer" }}
          >
            {busy ? "…" : run.hidden ? "Unhide" : "Hide"}
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
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
            {busy ? "…" : "Delete"}
          </button>
        </td>
      </tr>

      {payloadOpen && (
        <tr style={{ borderBottom: "1px solid #eee" }}>
          <td colSpan={8} style={{ padding: "0 0.4rem 0.75rem 0.4rem" }}>
            <StravaPanel
              loading={payloadLoading}
              error={payloadError}
              payload={payload}
              activityId={run.stravaActivityId}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * A monogram, not a photo. run.human's least-privilege `?summary=1` lookup
 * returns a display name only — no avatar URL — and widening that endpoint to
 * fetch one would also hand back the runner's email and MQTT credentials, which
 * have no business on this page.
 *
 * Colour is derived from the id so the same runner looks the same on every row,
 * which is what makes "three of these are the same person" visible at a glance.
 */
function Avatar({ owner, userId }: { owner?: HeatmapRun["owner"]; userId: string }) {
  const size = 28;
  const hue = [...userId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const initial = (owner?.displayName ?? userId).slice(0, 1).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `hsl(${hue} 45% 90%)`,
        color: `hsl(${hue} 45% 32%)`,
        border: `1px solid hsl(${hue} 40% 78%)`,
        fontSize: "0.8rem",
        fontWeight: 700,
      }}
    >
      {initial}
    </div>
  );
}

/**
 * The cached Strava activity.
 *
 * A MISS IS NOT AN ABSENCE. The snapshot is bounded at ~320 KB and drops the
 * OLDEST activities, so older runs routinely fall out of it. Each `reason` is
 * spelled out because an admin reading "not found" as "this run was fabricated"
 * would be a real harm.
 */
function StravaPanel({
  loading,
  error,
  payload,
  activityId,
}: {
  loading: boolean;
  error: string | null;
  payload: StravaPayload | null;
  activityId?: string;
}) {
  const shell: React.CSSProperties = {
    background: "#fbfbfb",
    border: "1px solid #e5e5e5",
    borderRadius: 4,
    padding: "0.6rem",
    fontSize: "0.75rem",
  };

  if (loading) return <div style={shell}>Loading cached activity…</div>;
  if (error) return <div style={{ ...shell, color: "#b00" }}>{error}</div>;
  if (!payload) return null;

  const link = activityId ? (
    <a
      href={`https://www.strava.com/activities/${activityId}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "#fc4c02" }}
    >
      Open on Strava ↗
    </a>
  ) : null;

  if (!payload.found) {
    const REASON: Record<string, string> = {
      "not-strava": "This run did not come from Strava.",
      "no-cache":
        "This runner has no cached Strava snapshot — they have not opened the strip or synced since caching began.",
      "not-in-snapshot":
        "Not in this runner's cached snapshot. The cache is capped at ~320 KB and drops the OLDEST activities first, so this is expected for older runs — it does NOT mean the activity is missing from Strava.",
    };
    return (
      <div style={shell}>
        <div style={{ color: "#8a6100" }}>{REASON[payload.reason]}</div>
        {payload.fetchedAt && (
          <div style={{ color: "#888", marginTop: 4 }}>
            Snapshot: {payload.snapshotSize ?? "?"} activities, fetched{" "}
            {new Date(payload.fetchedAt).toLocaleString()}
          </div>
        )}
        {link && <div style={{ marginTop: 6 }}>{link}</div>}
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={{ display: "flex", gap: "1rem", marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ color: "#888" }}>
          Activity {payload.activityId} · cached{" "}
          {new Date(payload.fetchedAt).toLocaleString()}
        </span>
        {link}
      </div>
      <pre
        style={{
          margin: 0,
          maxHeight: 260,
          overflow: "auto",
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: 3,
          padding: "0.5rem",
          fontSize: "0.7rem",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {JSON.stringify(payload.activity, null, 2)}
      </pre>
    </div>
  );
}
