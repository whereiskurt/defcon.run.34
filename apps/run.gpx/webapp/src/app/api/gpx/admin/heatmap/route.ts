import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client, BUCKET } from "@/lib/s3-client";
import { CON_DAYS } from "@/lib/con-days";
import { heatmapArtifactKey } from "@/lib/heatmap-artifact";
import { resolveOwners } from "@/lib/owner-directory";
import { isGpxAdmin } from "@/lib/gpx-admin";

const CON_DAY_DATES = new Set(CON_DAYS.map((d) => d.date));

/**
 * GET /api/gpx/admin/heatmap — the moderation roster for the public heat map.
 * Non-admins get 404 (non-disclosure), matching the other admin surfaces.
 *
 * WHY THIS EXISTS. The published artifact is deliberately non-attributable —
 * zero properties per feature, enforced by `assertNonAttributable` — so an admin
 * looking at an abusive shape on the map has no way to work back to the run that
 * produced it. This roster is the only join between what is drawn and who drew
 * it, and it therefore lists the SOURCE rows rather than reading the artifact.
 *
 * It mirrors the builder's selection (active + a real con-day + not GLOBAL) but
 * deliberately does NOT apply the `heatmapHidden` filter: an admin needs to see
 * what they already pulled in order to put it back.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!isGpxAdmin(services)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const scan = await GpxFile.scan
      .where(
        (attr, op) =>
          `${op.eq(attr.status, "active")} AND ${op.exists(attr.conDay)} AND ${op.ne(attr.userId, "GLOBAL")}`
      )
      .go({ pages: "all" });

    const selected = scan.data.filter(
      (r) => !!r.conDay && CON_DAY_DATES.has(r.conDay)
    );

    // Names come from run.human (run.gpx stores no runner profile of its own —
    // see lib/owner-directory.ts). Dedupe first: ~300 runs are typically ~60
    // runners. Best-effort — an unresolved id renders exactly as it did before.
    const owners = await resolveOwners([
      ...new Set(selected.map((r) => r.userId)),
    ]);

    const runs = selected
      .map((r) => ({
        fileId: r.fileId,
        userId: r.userId,
        fileName: r.fileName,
        conDay: r.conDay,
        totalDistance: r.totalDistance,
        trackCount: r.trackCount,
        source: r.source,
        stravaActivityId: r.stravaActivityId,
        createdAt: r.createdAt,
        hidden: r.heatmapHidden === true,
        owner: owners.get(r.userId),
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    // Surface when the artifact was last rebuilt so an admin can tell whether
    // their takedown is actually live yet — hiding a run only changes the source
    // row; the public map keeps serving the prebuilt artifact until a rebuild.
    let artifactGeneratedAt: string | null = null;
    let artifactRunCount: number | null = null;
    try {
      const obj = await s3Client.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: heatmapArtifactKey("dc34") })
      );
      const body = await obj.Body?.transformToString();
      if (body) {
        const parsed = JSON.parse(body) as {
          meta?: { generatedAt?: string; runCount?: number };
        };
        artifactGeneratedAt = parsed.meta?.generatedAt ?? null;
        artifactRunCount = parsed.meta?.runCount ?? null;
      }
    } catch {
      // No artifact yet (or unreadable) — the roster is still useful.
    }

    return NextResponse.json({
      runs,
      hiddenCount: runs.filter((r) => r.hidden).length,
      artifactGeneratedAt,
      artifactRunCount,
    });
  } catch (error) {
    console.error("Error listing heat-map runs for admin:", error);
    return NextResponse.json({ error: "Failed to list runs" }, { status: 500 });
  }
}
