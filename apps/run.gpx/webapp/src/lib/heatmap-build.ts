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
  MAX_RUNS,
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

/**
 * How many S3 GetObjects are in flight at once.
 *
 * Exported for the tests only — the cap assertion needs the loop's overshoot
 * allowance without hard-coding a literal that would silently go stale.
 */
export const CHUNK_SIZE = 20;

/**
 * THE BUILD'S REAL WALL-CLOCK BOUND — 240 s.
 *
 * The route used to carry `export const maxDuration = 300`, but `next.config.ts`
 * sets `output: "standalone"` and this app runs on ECS Fargate, so that export
 * is a serverless deployment hint the standalone Node server never enforces. The
 * build had NO upper bound at all, and the Terraform variable that claimed a
 * "CONTRACT" with it was written against a number nothing produced. This
 * constant, enforced in the chunk loop below, is the replacement — the only
 * bound that actually exists.
 *
 * IT IS THE INNERMOST LINK OF A STRICTLY INCREASING CHAIN:
 *
 *   builder aborts at 240 s
 *     < invoker Lambda's own fetch AbortSignal at 300 s
 *       < the Lambda's Terraform `lambda_timeout` at 420 s
 *
 * Strictly increasing, never equal. If the invoker's budget equals the build's,
 * the Lambda is killed mid-flight before the response arrives, its retry policy
 * fires up to two more invocations, and each starts a fresh full rebuild while
 * the first is still scanning — three concurrent unbounded scans plus three S3
 * fan-outs on a single ECS task, at exactly the moment the build is already
 * slow. With the chain intact the inner bound always fires first and the invoker
 * reports a real failure instead of a timeout.
 *
 * Plan 71-14 codes the outer two numbers against this one. CHANGING THIS VALUE
 * REQUIRES CHANGING THEM.
 */
const BUILD_BUDGET_MS = 240_000;

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
 * Ordering for the deduplicated rows: oldest first, ties broken on `fileId`.
 *
 * `localeCompare` rather than `a.fileId < b.fileId ? -1 : 1` because the latter
 * returned 1 for EQUAL elements (IN-01). An inconsistent comparator is one
 * refactor away from implementation-defined ordering, which would break the
 * deterministic-output property `dedupe` exists to provide. Exported so that
 * property can be asserted directly — the `Map` keyed on `fileId` means equal
 * elements are unreachable through the public path today, which is exactly why
 * the bug survived.
 */
export function compareRunRows(a: HeatmapRunRow, b: HeatmapRunRow): number {
  return a.createdAt - b.createdAt || a.fileId.localeCompare(b.fileId);
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
  return [...byFileId.values()].sort(compareRunRows);
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
  const startedAt = now().getTime();
  let chunksCompleted = 0;

  // BOUNDED concurrency. The aggregate route can afford one unbounded
  // Promise.all only because it caps at 500 routes; a precomputed builder
  // deliberately has no such cap, so it walks the rows in chunks instead.
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    // WALL-CLOCK BOUND (WR-03). Checked at the TOP of every chunk, because the
    // only place this loop can be interrupted safely is between chunks.
    //
    // ABORT, DO NOT SHRINK. Publishing whatever was collected so far would
    // overwrite a complete artifact with a truncated one and report the
    // truncated count as healthy — during the con that is strictly worse than
    // an artifact one schedule-interval stale, and the schedule retries within
    // the hour. Throwing also surfaces in the invoker's log and the scheduler's
    // failure record, where a silent shrink would not.
    const elapsed = now().getTime() - startedAt;
    if (elapsed >= BUILD_BUDGET_MS) {
      throw new Error(
        `[heatmap] dc34 build exceeded its ${BUILD_BUDGET_MS} ms wall-clock budget after ${chunksCompleted} chunk(s) — aborting without publishing`
      );
    }

    // TOTAL-WORK BOUND (WR-05). `assembleHeatmapArtifact` caps the feature list
    // at MAX_RUNS, so every row loaded past that point buys an S3 GetObject for
    // geometry that is then discarded — a 6000-row table paid 6000 reads to
    // publish 5000 features. Stop at the cap instead. This bounds the TOTAL
    // work; the chunk width above still bounds the CONCURRENT work.
    if (tracks.length >= MAX_RUNS) break;

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
    chunksCompleted++;
  }

  const generatedAt = now().toISOString();
  const artifact = assembleHeatmapArtifact("dc34", generatedAt, tracks);

  // LOUD TRUNCATION (WR-05). At the cap the build reports exactly MAX_RUNS,
  // which reads as a healthy number; `scanned`/`kept`/`skipped` do not reveal
  // that runs were dropped. Match the sibling aggregate route, which annotates
  // its own cap the same way. Counts only — no userId, no fileId, no S3 key.
  if (artifact.meta.runCount >= MAX_RUNS) {
    console.warn(
      `[heatmap] dc34 at the MAX_RUNS=${MAX_RUNS} cap: selected=${rows.length} collected=${tracks.length} published=${artifact.meta.runCount} — runs beyond the cap were dropped`
    );
  }

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
