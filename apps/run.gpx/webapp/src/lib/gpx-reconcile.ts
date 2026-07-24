/**
 * GPX <-> leaderboard full-recalc reconcile (Task 4, leaderboard<->runs sync).
 *
 * Where gpx-accomplishment.ts's `notifyAccomplishment` is a single POST fired
 * once when a run is created, `reconcileAccomplishments` re-derives a runner's
 * ENTIRE con-day-tagged run set from GpxFile and asks run.human to converge
 * its Accomplishment rows to match: PUT the current live summary set to
 * run.human's internal reconcile endpoint (which deletes anything run.human
 * has that this runner no longer has, and reports back what it's missing),
 * then backfill each missing one with a fresh POST built the same way the
 * confirm route always has (parseTrack -> buildAccomplishmentPayload ->
 * notifyAccomplishment).
 *
 * Every mutation path that can change a runner's live run set (confirm,
 * con-day retag, delete, Strava import/sync) fires `reconcileBestEffort`
 * afterward — fire-and-forget, matching `notifyAccomplishment`'s T-50-06
 * contract: a leaderboard hiccup must never fail (or even slow down) the
 * runner's actual save/delete/import.
 */

import { GpxFile } from "@/entities/gpx-file";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "@/lib/s3-client";
import {
  parseTrack,
  buildAccomplishmentPayload,
  notifyAccomplishment,
  humanInternalUrl,
} from "@/lib/gpx-accomplishment";

/** The GpxFile fields reconcile needs — a narrowed view, not the full entity item. */
export type GpxFileRow = {
  userId: string;
  fileId: string;
  fileName: string;
  bucket: string;
  key: string;
  status: string;
  conDay?: string;
  source?: string;
  stravaActivityId?: string;
};

/** A run's identity + provenance, as sent to run.human's reconcile PUT. */
type RunSummary = {
  gpxFileId: string;
  source: "gpx" | "strava";
  stravaActivityId?: string;
};

type ReconcilePutResponse = {
  ok: boolean;
  deleted: number;
  missing: string[];
};

/**
 * A con-day-tagged run has no time-of-day on the GpxFile — only the con-day
 * date. Noon Pacific (the con's home timezone) on that date is the same
 * synthetic `completedAt` the confirm route would produce if it re-ran today,
 * so a reconciled backfill lands at the same instant a fresh save would.
 */
export function conDayCompletedAt(conDay: string): number {
  return Date.parse(`${conDay}T12:00:00-07:00`);
}

async function defaultListFiles(sub: string): Promise<GpxFileRow[]> {
  const res = await GpxFile.query.primary({ userId: sub }).go({ pages: "all" });
  return res.data as unknown as GpxFileRow[];
}

async function defaultLoadGpx(bucket: string, key: string): Promise<string> {
  const obj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return (await obj.Body?.transformToString()) ?? "";
}

/** Non-"strava" GpxFile.source values ("upload"/"draw"/"converted"/undefined) all read as "gpx" on the wire. */
function toWireSource(source: string | undefined): "gpx" | "strava" {
  return source === "strava" ? "strava" : "gpx";
}

/**
 * Re-derive this runner's live con-day-tagged run set and converge
 * run.human's Accomplishment rows to match it.
 *
 * `deps` lets tests inject the S3/DynamoDB/fetch seams; all default to the
 * real GpxFile query, real S3 GetObject, and the global `fetch`.
 */
export async function reconcileAccomplishments(
  oidcSub: string,
  deps?: {
    fetchImpl?: typeof fetch;
    listFiles?: (sub: string) => Promise<GpxFileRow[]>;
    loadGpx?: (bucket: string, key: string) => Promise<string>;
  }
): Promise<{ deleted: number; created: number }> {
  const listFiles = deps?.listFiles ?? defaultListFiles;
  const loadGpx = deps?.loadGpx ?? defaultLoadGpx;
  const fetchImpl = deps?.fetchImpl;
  const doFetch = fetchImpl ?? fetch;

  const files = await listFiles(oidcSub);
  const runs = files.filter(
    (f) => f.status === "active" && f.conDay && f.userId !== "GLOBAL"
  );
  const byFileId = new Map(runs.map((f) => [f.fileId, f]));

  const summaries: RunSummary[] = runs.map((f) => ({
    gpxFileId: f.fileId,
    source: toWireSource(f.source),
    ...(f.stravaActivityId ? { stravaActivityId: f.stravaActivityId } : {}),
  }));

  let putResult: ReconcilePutResponse;
  try {
    const res = await doFetch(humanInternalUrl("/api/internal/accomplishment/reconcile"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": process.env.AUTH_INTERNAL_SECRET || "",
      },
      body: JSON.stringify({ oidcSub, runs: summaries }),
    });
    if (!res.ok) {
      // Caller-visible soft-fail — a reconcile hiccup must never throw.
      return { deleted: 0, created: 0 };
    }
    putResult = (await res.json()) as ReconcilePutResponse;
  } catch {
    return { deleted: 0, created: 0 };
  }

  let created = 0;
  for (const gpxFileId of putResult.missing ?? []) {
    const file = byFileId.get(gpxFileId);
    if (!file || !file.conDay) continue; // shouldn't happen — defensive
    try {
      const gpxText = await loadGpx(file.bucket, file.key);
      const { points, distance, elevation } = parseTrack(gpxText);
      const payload = buildAccomplishmentPayload({
        oidcSub,
        gpxFileId: file.fileId,
        name: file.fileName,
        points,
        distance,
        elevation,
        completedAt: conDayCompletedAt(file.conDay),
        conDay: file.conDay,
        source: toWireSource(file.source),
        stravaActivityId: file.stravaActivityId,
      });
      await notifyAccomplishment(payload, fetchImpl);
      created++;
    } catch {
      // Skip a missing id whose file/gpx-text fails to load — count only
      // successful backfills.
    }
  }

  return { deleted: putResult.deleted ?? 0, created };
}

/**
 * Fire-and-forget trigger for every run-mutation write path. Swallows
 * EVERYTHING (rejection or, defensively, a synchronous throw) so a
 * leaderboard reconcile hiccup can never break the caller's actual mutation
 * (T-50-06, same contract as notifyAccomplishment). Logs one sub-less line
 * with just the resulting counts — never the sub, never a fileId.
 */
export function reconcileBestEffort(oidcSub: string): void {
  try {
    void reconcileAccomplishments(oidcSub)
      .then((result) => {
        console.log(
          `[gpx-reconcile] best-effort ok: deleted=${result.deleted} created=${result.created}`
        );
      })
      .catch((err) => {
        console.log(
          "[gpx-reconcile] best-effort failed:",
          err instanceof Error ? err.message : err
        );
      });
  } catch (err) {
    console.log(
      "[gpx-reconcile] best-effort threw synchronously:",
      err instanceof Error ? err.message : err
    );
  }
}
