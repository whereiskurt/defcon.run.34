/**
 * DC34 heat-map artifact builder (Phase 71, HEAT-02).
 *
 * Selects every con-day-assigned run, reads its GPX geometry from S3, assembles
 * the non-attributable artifact and writes it to `uploads/HEATMAP/dc34.json`.
 * Invoked by `POST /api/gpx/internal/heatmap-build` on an EventBridge schedule.
 *
 * ONE SOURCE, NOT TWO. `GpxFile` carries no polyline attribute: `lib/strava-sync.ts`
 * materialises every Strava import as a real GPX object in S3 at import time and
 * writes a `GpxFile` row for it. So "GPX tracks + Strava summary_polylines" is a
 * single read path here — one `GpxFile` row is one run is one track. The encoded
 * polyline decoder (`lib/polyline-decode.ts`) exists only for the DC33 backfill,
 * which reads a frozen export rather than this table.
 *
 * `deps` mirrors the injectable-deps seam in `lib/gpx-reconcile.ts` so the whole
 * service is unit-testable with no DynamoDB and no S3.
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client, BUCKET } from "@/lib/s3-client";
import { CON_DAYS } from "@/lib/con-days";
import {
  trkptCoords,
  assembleHeatmapArtifact,
  assertNonAttributable,
  heatmapArtifactKey,
} from "@/lib/heatmap-artifact";

/**
 * The GpxFile fields the builder needs — a narrowed view, not the full entity
 * item. The entity's owner opt-in flag is deliberately absent: this surface
 * never reads it (D-03, see the selection block below), so it is not part of
 * the builder's row contract. Real scan rows carry extra attributes; they are
 * simply ignored.
 */
export type HeatmapRunRow = {
  userId: string;
  fileId: string;
  bucket: string;
  key: string;
  status: string;
  conDay?: string;
  stravaActivityId?: string;
  createdAt: number;
};

export type BuildDeps = {
  listRuns?: () => Promise<HeatmapRunRow[]>;
  loadGpx?: (bucket: string, key: string) => Promise<string>;
  putArtifact?: (key: string, body: string) => Promise<void>;
  now?: () => Date;
};

export type HeatmapBuildResult = {
  year: "dc34";
  generatedAt: string;
  runCount: number;
  totalKm: number;
  scanned: number;
  skipped: number;
};

/** How many S3 GetObjects are in flight at once. */
const CHUNK_SIZE = 20;

const CON_DAY_DATES = new Set(CON_DAYS.map((d) => d.date));

/**
 * The D-03 selection.
 *
 * Structurally this is `api/gpx/public/aggregate/route.ts:37-42` with the
 * `includeInAggregate` clause REMOVED. That subtraction is deliberate and is
 * the requirement, not an oversight: Kurt decided on 2026-07-30 that the con
 * heat map covers ALL submitted runs, with no owner opt-in gate. The
 * compensating control is the zero-properties output enforced by
 * `assertNonAttributable` on the write path below — nothing in the artifact can
 * be traced to a runner. DO NOT "restore" the missing predicate; doing so
 * silently empties the heat map and contradicts a user-locked decision (there
 * is a test in `heatmap-build.test.ts` that fails if you do).
 */
async function defaultListRuns(): Promise<HeatmapRunRow[]> {
  const scan = await GpxFile.scan
    .where(
      (attr, op) =>
        `${op.eq(attr.status, "active")} AND ${op.exists(attr.conDay)} AND ${op.ne(attr.userId, "GLOBAL")}`
    )
    .go({ pages: "all" });
  return scan.data as unknown as HeatmapRunRow[];
}

/** Mirrors `gpx-reconcile.ts:72-75`. */
async function defaultLoadGpx(bucket: string, key: string): Promise<string> {
  const obj = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  return (await obj.Body?.transformToString()) ?? "";
}

/**
 * The phase's first computed-artifact S3 write — PATTERNS.md has no analog
 * beyond `scripts/import-dc33.ts:17`, so this is the reference shape for the
 * DC33 backfill (71-04) to copy.
 */
async function defaultPutArtifact(key: string, body: string): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json",
    })
  );
}

/**
 * Year selection: `conDay` must be one of `CON_DAYS[].date` — the same list the
 * con-day picker writes — so "a run tagged for the con" and "a run in the dc34
 * artifact" are the same set by construction.
 */
function isSelected(r: HeatmapRunRow): boolean {
  return (
    r.status === "active" &&
    !!r.conDay &&
    CON_DAY_DATES.has(r.conDay) &&
    r.userId !== "GLOBAL"
  );
}

/**
 * Collapse rows sharing a non-empty `stravaActivityId` (the same activity
 * re-imported), keeping the smallest `createdAt`; ties break on `fileId` string
 * order so the result is deterministic. Then de-duplicate on `fileId`.
 */
function dedupe(rows: HeatmapRunRow[]): HeatmapRunRow[] {
  const byActivity = new Map<string, HeatmapRunRow>();
  const rest: HeatmapRunRow[] = [];
  for (const r of rows) {
    const activityId = r.stravaActivityId;
    if (!activityId) {
      rest.push(r);
      continue;
    }
    const held = byActivity.get(activityId);
    if (
      !held ||
      r.createdAt < held.createdAt ||
      (r.createdAt === held.createdAt && r.fileId < held.fileId)
    ) {
      byActivity.set(activityId, r);
    }
  }

  const byFileId = new Map<string, HeatmapRunRow>();
  for (const r of [...byActivity.values(), ...rest]) {
    if (!byFileId.has(r.fileId)) byFileId.set(r.fileId, r);
  }

  // Stable output order regardless of scan order.
  return [...byFileId.values()].sort(
    (a, b) => a.createdAt - b.createdAt || (a.fileId < b.fileId ? -1 : 1)
  );
}

export async function buildDc34Heatmap(
  deps?: BuildDeps
): Promise<HeatmapBuildResult> {
  const listRuns = deps?.listRuns ?? defaultListRuns;
  const loadGpx = deps?.loadGpx ?? defaultLoadGpx;
  const putArtifact = deps?.putArtifact ?? defaultPutArtifact;
  const now = deps?.now ?? (() => new Date());

  const all = await listRuns();
  const scanned = all.length;
  const rows = dedupe(all.filter(isSelected));

  const tracks: [number, number][][] = [];
  let skipped = 0;

  // BOUNDED concurrency. The aggregate route can afford one unbounded
  // Promise.all only because it caps at 500 routes; a precomputed builder
  // deliberately has no such cap, so it walks the rows in chunks instead.
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (r) => {
        try {
          const gpx = await loadGpx(r.bucket, r.key);
          if (!gpx) return null;
          const coords = trkptCoords(gpx);
          if (coords.length < 2) return null;
          return coords;
        } catch {
          // One unreadable object must never abort the batch.
          return null;
        }
      })
    );
    for (const coords of results) {
      if (coords) tracks.push(coords);
      else skipped++;
    }
  }

  const generatedAt = now().toISOString();
  const artifact = assembleHeatmapArtifact("dc34", generatedAt, tracks);

  // THE CHOKEPOINT. Must stay immediately before the write and must NOT be
  // wrapped in a try/catch that continues: a throw means "do not publish".
  assertNonAttributable(artifact);

  await putArtifact(heatmapArtifactKey("dc34"), JSON.stringify(artifact));

  // Counts only — no userId, no fileId, no S3 key (T-71-08).
  console.log(
    `[heatmap] dc34 built: scanned=${scanned} kept=${artifact.meta.runCount} skipped=${skipped} totalKm=${artifact.meta.totalKm}`
  );

  return {
    year: "dc34",
    generatedAt,
    runCount: artifact.meta.runCount,
    totalKm: artifact.meta.totalKm,
    scanned,
    skipped,
  };
}
