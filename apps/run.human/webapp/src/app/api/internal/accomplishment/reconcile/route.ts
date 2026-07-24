import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getAdapterUserIdBySub } from "@/entities/auth-user";
import {
  getAccomplishmentsByUser,
  deleteAccomplishment,
} from "@/entities/accomplishment";
import { bustDrillCache } from "@/lib/leaderboard-drill-cache";
import { diffAccomplishments, type ReconcileRun } from "@/lib/accomplishment-reconcile";

/**
 * Internal API: reconcile a run.human user's gpx/strava Accomplishment rows
 * against the run set reported by the source of truth (Task 3).
 *
 * Secret-gated, server-to-server only — run.gpx (and strava sync) POST/PUT
 * here with the full current run set for a user so this route can delete any
 * accomplishment whose source file/activity no longer exists on that side
 * (e.g. a gpx file was deleted, or a strava sync unlinked an activity). This
 * mirrors `api/internal/accomplishment/route.ts`'s trust model exactly.
 *
 * Body: { oidcSub, runs: { gpxFileId, source, stravaActivityId? }[] }
 *
 * Trust boundaries (threat register, same class as T-50-*):
 *  - spoofing: reject any request whose `x-internal-secret` header !==
 *    config.auth.internalSecret with 403 BEFORE parsing the body or touching
 *    the data layer. The secret is the sole authorization.
 *  - elevation of privilege: `diffAccomplishments` only ever orphans rows with
 *    source "gpx"/"strava" — `checkin` rows are never touched by this route.
 *  - info disclosure: logs carry only counts (deleted/missing), NEVER the
 *    secret or the full body.
 */
export async function PUT(req: NextRequest) {
  // Secret gate first — before any body parse or data-layer access.
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { oidcSub?: unknown; runs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const oidcSub = typeof body.oidcSub === "string" ? body.oidcSub : "";
  if (!oidcSub) {
    return NextResponse.json({ error: "Missing oidcSub" }, { status: 400 });
  }

  const runs = validateRuns(body.runs);
  if (!runs) {
    return NextResponse.json({ error: "Invalid runs" }, { status: 400 });
  }

  try {
    const userId = await getAdapterUserIdBySub(oidcSub);
    if (!userId) {
      // No run.human identity maps to this sub -> log (no secret/body) and
      // benign-drop, same as the sibling create route.
      console.log(
        "[run.human] /api/internal/accomplishment/reconcile dropped: no run.human user for sub"
      );
      return NextResponse.json({ dropped: true }, { status: 200 });
    }

    const existing = await getAccomplishmentsByUser(userId);
    const { orphanIds, missingFileIds } = diffAccomplishments(existing, runs);

    for (const accomplishmentId of orphanIds) {
      await deleteAccomplishment(userId, accomplishmentId);
    }
    bustDrillCache(userId);

    console.log(
      `[run.human] /api/internal/accomplishment/reconcile userId=${userId} deleted=${orphanIds.length} missing=${missingFileIds.length}`
    );

    return NextResponse.json(
      { ok: true, deleted: orphanIds.length, missing: missingFileIds },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "[run.human] /api/internal/accomplishment/reconcile error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Validate + coerce the reported run set (PURE, no I/O). Each entry must have
 * a string `gpxFileId`; `source` is coerced to "strava" only on an exact
 * match, defaulting to "gpx" otherwise; `stravaActivityId` is kept only if a
 * string. Returns null on any malformed entry (or if `raw` isn't an array) so
 * the route can 400 before touching the data layer.
 */
function validateRuns(raw: unknown): ReconcileRun[] | null {
  if (!Array.isArray(raw)) return null;

  const runs: ReconcileRun[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const gpxFileId = (entry as Record<string, unknown>).gpxFileId;
    if (typeof gpxFileId !== "string") return null;

    const rawSource = (entry as Record<string, unknown>).source;
    const source: ReconcileRun["source"] = rawSource === "strava" ? "strava" : "gpx";

    const rawStravaId = (entry as Record<string, unknown>).stravaActivityId;
    const stravaActivityId =
      typeof rawStravaId === "string" ? rawStravaId : undefined;

    runs.push({ gpxFileId, source, stravaActivityId });
  }
  return runs;
}
