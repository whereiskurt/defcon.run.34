import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client } from "@/lib/s3-client";
import { CON_DAYS } from "@/lib/con-days";
import { trkptCoords } from "@/lib/heatmap-artifact";
import { buildRunShape, trkptTimes, type RunShape } from "@/lib/heatmap-shape";
import { isGpxAdmin } from "@/lib/gpx-admin";

const CON_DAY_DATES = new Set(CON_DAYS.map((d) => d.date));

/** How many S3 GetObjects are in flight at once — the builder's number. */
const CHUNK_SIZE = 20;

/**
 * Process-level shape cache.
 *
 * The ECS service runs `desired_count 1` with autoscaling OFF (see the DDB
 * pressure audit), so a per-process cache is a real cache rather than a coin
 * flip across replicas. Keyed on `fileId:updatedAt` so an edited run re-renders
 * with no explicit invalidation — a stale thumbnail on a moderation page would
 * be worse than a slow one.
 *
 * If the service ever scales past one task this stops being a guaranteed hit
 * and becomes a per-task hit. That degrades latency, never correctness.
 */
const CACHE_MAX = 1000;
const shapeCache = new Map<string, RunShape>();

function cacheGet(key: string): RunShape | undefined {
  return shapeCache.get(key);
}

function cacheSet(key: string, value: RunShape): void {
  if (shapeCache.size >= CACHE_MAX) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = shapeCache.keys().next().value;
    if (oldest !== undefined) shapeCache.delete(oldest);
  }
  shapeCache.set(key, value);
}

/**
 * GET /api/gpx/admin/heatmap/shapes — the thumbnail geometry for the
 * moderation roster. Non-admins get 404 (non-disclosure).
 *
 * SEPARATE FROM THE ROSTER ON PURPOSE. This reads ~300 GPX objects out of S3;
 * folding it into `GET /api/gpx/admin/heatmap` would put every one of those in
 * front of first paint. The table renders from the roster immediately and fills
 * thumbnails in when this lands.
 *
 * A per-file read failure lands that fileId in `failed` instead of failing the
 * response — one unreadable object must not blind the whole page.
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
    // Mirrors the roster's selection (route.ts) — including its deliberate
    // omission of the `heatmapHidden` filter, because an admin needs to see the
    // shape of a run they already pulled in order to decide whether to put it
    // back.
    const scan = await GpxFile.scan
      .where(
        (attr, op) =>
          `${op.eq(attr.status, "active")} AND ${op.exists(attr.conDay)} AND ${op.ne(attr.userId, "GLOBAL")}`
      )
      .go({ pages: "all" });

    const rows = scan.data.filter((r) => !!r.conDay && CON_DAY_DATES.has(r.conDay));

    const shapes: Record<string, RunShape> = {};
    const failed: string[] = [];

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (r) => {
          const cacheKey = `${r.fileId}:${r.updatedAt}`;
          const hit = cacheGet(cacheKey);
          if (hit) {
            shapes[r.fileId] = hit;
            return;
          }
          try {
            const obj = await s3Client.send(
              new GetObjectCommand({ Bucket: r.bucket, Key: r.key })
            );
            const gpx = (await obj.Body?.transformToString()) ?? "";
            const shape = buildRunShape(trkptCoords(gpx), trkptTimes(gpx));
            cacheSet(cacheKey, shape);
            shapes[r.fileId] = shape;
          } catch (e) {
            console.error(`[admin/heatmap/shapes] ${r.fileId}:`, e);
            failed.push(r.fileId);
          }
        })
      );
    }

    return NextResponse.json({ shapes, failed });
  } catch (error) {
    console.error("Error building admin heat-map shapes:", error);
    return NextResponse.json({ error: "Failed to load shapes" }, { status: 500 });
  }
}
