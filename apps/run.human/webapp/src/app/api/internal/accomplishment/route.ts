import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config";
import { getAdapterUserIdBySub } from "@/entities/auth-user";
import { createAccomplishment } from "@/entities/accomplishment";
import { buildGpxAccomplishmentInput } from "@/lib/gpx-accomplishment-input";

/**
 * Internal API: create an accomplishment from GPX or Strava (LDBR-06 / LDBR-55).
 *
 * Secret-gated, server-to-server only. run.gpx POSTs here after a GPX file is
 * activated (Plan 50-02); strava sync also POSTs here. This route resolves the
 * OIDC sub -> run.human adapter userId and calls the already-built (Phase 49)
 * `createAccomplishment` with a SERVER-FIXED source ("gpx" or "strava" per the
 * request, but never ctf/qr — idempotent on gpxFileId/stravaActivityId).
 *
 * Body: { oidcSub, gpxFileId, name, distance?, elevation?, polyline?, completedAt, source?, stravaActivityId?, conDay? }
 *
 * Trust boundaries (threat register):
 *  - T-50-01 (spoofing): reject any request whose `x-internal-secret` header !==
 *    config.auth.internalSecret with 403 BEFORE parsing the body or touching the
 *    data layer. The secret is the sole authorization.
 *  - T-50-03 (elevation of privilege): the body cannot inject a non-gpx/strava source —
 *    `source` is fixed inside buildGpxAccomplishmentInput (LDBR-12 CTF boundary).
 *  - T-50-04 (info disclosure): the benign-drop / error logs carry gpxFileId + a
 *    message only, NEVER the secret or the full body.
 */
export async function POST(req: NextRequest) {
  // T-50-01: secret gate first — before any body parse or data-layer access.
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    oidcSub?: unknown;
    gpxFileId?: unknown;
    name?: unknown;
    distance?: unknown;
    elevation?: unknown;
    polyline?: unknown;
    completedAt?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const oidcSub = typeof body.oidcSub === "string" ? body.oidcSub : "";
  if (!oidcSub) {
    return NextResponse.json({ error: "Missing oidcSub" }, { status: 400 });
  }

  try {
    const userId = await getAdapterUserIdBySub(oidcSub);
    if (!userId) {
      // A runner must have a run.human identity to score. No account maps to
      // this sub -> log (gpxFileId only, never the secret) and benign-drop.
      const gpxFileId =
        typeof body.gpxFileId === "string" ? body.gpxFileId : "(none)";
      console.log(
        `[run.human] /api/internal/accomplishment dropped: no run.human user for sub (gpxFileId=${gpxFileId})`
      );
      return NextResponse.json({ dropped: true }, { status: 200 });
    }

    // Source is server-fixed to "gpx" inside the builder; createAccomplishment
    // is idempotent on gpxFileId, so a replay is a no-op (no double-score).
    await createAccomplishment(buildGpxAccomplishmentInput(body, userId));
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[run.human] /api/internal/accomplishment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
