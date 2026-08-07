"use client";

import { useState } from "react";
import { adminApiUrl } from "@/lib/admin-api-base";

type Result = {
  candidates: number;
  tagged: number;
  notEligible: number;
  noToken: number;
  notFound: number;
  failed: number;
  byDay: Record<string, number>;
  dryRun: boolean;
};

/**
 * "Re-calc GPX con-days" — the UI for POST /api/gpx/admin/con-day-backfill.
 *
 * WHY IT EXISTS: the unattended Strava sweep imported runs with no `conDay`,
 * and `conDay` is the sole gate on the heat map (and the leaderboard). The
 * auto-tag added 2026-08-07 fixes new imports, but `syncAllUsers` dedupes on
 * `stravaActivityId` BEFORE importing, so already-imported activities are
 * skipped forever and can only be recovered by refetching them from Strava.
 *
 * TWO-STAGE BY DESIGN. The first click is a DRY RUN: it makes the identical
 * Strava calls and reports the identical tally, but writes nothing. Only then
 * does Apply appear. The endpoint defaults to dry as well, so a write needs an
 * explicit `confirm` from both sides — this touches other people's runs and
 * puts them on a public map, which is not a thing to do on one stray click.
 *
 * Safe to re-run: only rows still lacking a `conDay` are ever considered.
 *
 * NOTE the tagged rows do not reach the public map until Regenerate runs —
 * same as Hide/Delete above.
 */
export default function ConDayBackfillButton() {
  const [busy, setBusy] = useState<null | "dry" | "apply">(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(confirm: boolean) {
    setBusy(confirm ? "apply" : "dry");
    setError(null);
    if (!confirm) {
      setPreview(null);
      setDone(null);
    }
    try {
      const res = await fetch(adminApiUrl("/api/gpx/admin/con-day-backfill"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirm ? { confirm: true } : {}),
      });
      // 404 is the admin gate's non-disclosure denial, not a missing route.
      if (!res.ok) {
        throw new Error(
          res.status === 404 ? "Not authorized" : `Failed (${res.status})`
        );
      }
      const data = (await res.json()) as Result;
      if (confirm) {
        setDone(data);
        setPreview(null);
      } else {
        setPreview(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const days = (r: Result) =>
    Object.entries(r.byDay)
      .sort()
      .map(([d, n]) => `${d}: ${n}`)
      .join(", ") || "none";

  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        margin: "1rem 0",
      }}
    >
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => void run(false)}
          disabled={busy !== null}
          style={{
            padding: "0.5rem 1rem",
            cursor: busy ? "wait" : "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "#333",
            border: 0,
            borderRadius: 6,
          }}
        >
          {busy === "dry" ? "Checking Strava…" : "Re-calc GPX con-days"}
        </button>

        {preview && (
          <button
            onClick={() => void run(true)}
            disabled={busy !== null || preview.tagged === 0}
            style={{
              padding: "0.5rem 1rem",
              cursor: busy ? "wait" : "pointer",
              fontWeight: 600,
              color: "#fff",
              background: preview.tagged > 0 ? "#b06a00" : "#555",
              border: 0,
              borderRadius: 6,
            }}
          >
            {busy === "apply"
              ? "Applying…"
              : `Apply — tag ${preview.tagged} run${preview.tagged === 1 ? "" : "s"}`}
          </button>
        )}

        {error && <span style={{ color: "#c00" }}>{error}</span>}
      </div>

      <p style={{ color: "#666", fontSize: "0.85rem", margin: "0.6rem 0 0" }}>
        Asks Strava for the real date of runs the overnight sync imported
        untagged, then tags the ones that fall on a con day. Rides are skipped.
        The first click only previews — nothing is written until you press Apply,
        and tagged runs reach the public map on the next Regenerate.
      </p>

      {preview && (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
          <strong>Preview (nothing written):</strong> {preview.candidates} checked
          → <strong>{preview.tagged} would be tagged</strong> ({days(preview)}).{" "}
          {preview.notEligible} not a con day or a ride
          {preview.noToken > 0 && `, ${preview.noToken} no Strava link`}
          {preview.notFound > 0 && `, ${preview.notFound} gone from Strava`}
          {preview.failed > 0 && `, ${preview.failed} failed`}.
        </p>
      )}

      {done && (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", color: "#0a7d28" }}>
          <strong>Tagged {done.tagged}</strong> ({days(done)}).{" "}
          {done.failed > 0 && (
            <span style={{ color: "#c00" }}>{done.failed} failed — see logs. </span>
          )}
          Press <strong>Regenerate</strong> to publish them to the map.
        </p>
      )}
    </div>
  );
}
