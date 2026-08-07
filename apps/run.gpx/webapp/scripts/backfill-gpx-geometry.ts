/**
 * backfill-gpx-geometry.ts — one-off, idempotent, re-runnable sweep that fills
 * in the geometry attributes hand-uploaded GPX rows never got.
 *
 * WHY THIS EXISTS. `POST /api/gpx/files` took trackCount/totalDistance/
 * totalElevation from the CLIENT request body and defaulted them to 0, and the
 * confirm step (which downloads the object anyway) only ever set
 * `status: "active"`. The studio never sends a distance, so every hand-uploaded
 * run stored `totalDistance: 0` and no `bounds` at all — 10 of the 71 active
 * con-day runs as of 2026-08-07. Strava imports were unaffected: their creator
 * sets both fields from the activity payload, which is why "no distance" and
 * "no source" correlate perfectly in the data.
 *
 * The forward fix lives in `api/gpx/files/[id]/confirm/route.ts`. This script is
 * the one-time catch-up for rows that were confirmed before it shipped.
 *
 * SCOPE — GEOMETRY ONLY (Kurt, 2026-08-07). It writes trackCount,
 * waypointCount, totalDistance, totalElevation and bounds. It does NOT write
 * `source`. Those rows have no `source` attribute and will keep rendering "—"
 * in that column; backfilling "upload" would be asserting user-authored
 * provenance retroactively, which is a claim this script has no business
 * making. Do not "finish the job" by adding it.
 *
 * SCORES ARE NOT AFFECTED, IN EITHER DIRECTION. `lib/gpx-reconcile.ts`
 * re-parses each object out of S3 with `parseTrack` and never reads these
 * attributes, so the leaderboard already had the true distances and nothing
 * here changes anyone's total. That is also why this script deliberately does
 * NOT call reconcile.
 *
 * INVOCATION — from `apps/run.gpx/webapp`:
 *
 *   # dry run: reads S3, prints what WOULD change, writes nothing
 *   AWS_PROFILE=dc34-application npx tsx scripts/backfill-gpx-geometry.ts \
 *     --table run-gpx-electro --bucket <uploads-bucket>
 *
 *   # apply
 *   AWS_PROFILE=dc34-application npx tsx scripts/backfill-gpx-geometry.ts \
 *     --table run-gpx-electro --bucket <uploads-bucket> --apply
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. --apply is required to write.
 *   - --table and --bucket are REQUIRED with no defaults, so a missing flag
 *     fails loud instead of silently resolving to the wrong table.
 *   - --help exits 0 without constructing an AWS client or touching the network.
 *   - Only rows that are active AND currently have a falsy totalDistance are
 *     considered, so a re-run is a no-op and a row with a real distance is
 *     never overwritten.
 *   - A row whose object is unreadable, too large to summarize honestly, or
 *     genuinely trackless is REPORTED AND SKIPPED. Writing 0 over 0 buys
 *     nothing and would hide the trackless ones.
 */

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { summarizeGpxText, contentRangeTotal } from "../src/lib/route-summary";

const MAX_BYTES = 25 * 1024 * 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usage(): never {
  console.log(
    `
backfill-gpx-geometry — fill in geometry for hand-uploaded GPX rows.

  --table   <name>   DynamoDB table (required, e.g. run-gpx-electro)
  --bucket  <name>   S3 uploads bucket (required)
  --region  <name>   AWS region (default us-east-1)
  --apply            write; omit for a dry run
  --help             this text

Writes trackCount, waypointCount, totalDistance, totalElevation, bounds.
Never writes source. Never touches the leaderboard.
`.trim()
  );
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--help")) usage();

  const table = arg("table");
  const bucket = arg("bucket");
  const region = arg("region") ?? "us-east-1";
  const apply = process.argv.includes("--apply");

  if (!table || !bucket) {
    console.error("ERROR: --table and --bucket are both required. --help for usage.");
    process.exit(1);
  }

  const ddb = new DynamoDBClient({ region });
  const s3 = new S3Client({ region });

  console.log(`${apply ? "APPLY" : "DRY RUN"} · table=${table} bucket=${bucket}\n`);

  // Scan for active rows with no usable distance. `attribute_not_exists OR = 0`
  // covers both shapes: rows created before the attribute had a default, and
  // rows that stored the client's absent value as 0.
  const candidates: Record<string, { S?: string; N?: string }>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression:
          "#s = :active AND (attribute_not_exists(totalDistance) OR totalDistance = :zero)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":active": { S: "active" },
          ":zero": { N: "0" },
        },
        ExclusiveStartKey: startKey as never,
      })
    );
    candidates.push(...((page.Items ?? []) as never[]));
    startKey = page.LastEvaluatedKey as never;
  } while (startKey);

  console.log(`${candidates.length} candidate row(s)\n`);

  let updated = 0;
  let skipped = 0;

  for (const item of candidates) {
    const pk = item.pk?.S;
    const sk = item.sk?.S;
    const key = item.key?.S;
    const name = item.fileName?.S ?? "(unnamed)";
    if (!pk || !sk || !key) {
      console.log(`  SKIP  ${name} — missing pk/sk/key`);
      skipped++;
      continue;
    }

    let summary: ReturnType<typeof summarizeGpxText> | null = null;
    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${MAX_BYTES}` })
      );
      const total = contentRangeTotal(obj.ContentRange);
      if (total !== null && total > MAX_BYTES) {
        console.log(`  SKIP  ${name} — ${total} bytes, too large to summarize honestly`);
        skipped++;
        continue;
      }
      const text = (await obj.Body?.transformToString()) ?? "";
      summary = summarizeGpxText(text);
    } catch (e) {
      console.log(`  SKIP  ${name} — S3 read failed: ${(e as Error).message}`);
      skipped++;
      continue;
    }

    if (!summary.totalDistance) {
      // Genuinely trackless (a distance-only import, or a waypoint-only file).
      // 0 is already stored and is already correct.
      console.log(`  SKIP  ${name} — no track points, 0 is correct`);
      skipped++;
      continue;
    }

    const km = (summary.totalDistance / 1000).toFixed(2);
    console.log(
      `  ${apply ? "WRITE" : "would"} ${name} — ${km} km, ${summary.totalElevation} m gain, ` +
        `${summary.trackCount} trk/${summary.waypointCount} wpt` +
        `${summary.bounds ? "" : " (no bounds)"}`
    );

    if (apply) {
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      const put = (attr: string, value: unknown) => {
        names[`#${attr}`] = attr;
        values[`:${attr}`] = value;
        sets.push(`#${attr} = :${attr}`);
      };

      put("totalDistance", { N: String(summary.totalDistance) });
      put("totalElevation", { N: String(summary.totalElevation) });
      put("trackCount", { N: String(summary.trackCount) });
      put("waypointCount", { N: String(summary.waypointCount) });
      if (summary.bounds) {
        put("bounds", {
          M: {
            minLat: { N: String(summary.bounds.minLat) },
            maxLat: { N: String(summary.bounds.maxLat) },
            minLon: { N: String(summary.bounds.minLon) },
            maxLon: { N: String(summary.bounds.maxLon) },
          },
        });
      }
      // ElectroDB stamps this on every write; keep it honest for anything that
      // reads it (the admin shapes cache keys on it).
      put("updatedAt", { N: String(Date.now()) });

      await ddb.send(
        new UpdateItemCommand({
          TableName: table,
          Key: { pk: { S: pk }, sk: { S: sk } },
          UpdateExpression: `SET ${sets.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values as never,
        })
      );
      updated++;
    }
  }

  console.log(
    `\n${apply ? "updated" : "would update"} ${apply ? updated : candidates.length - skipped}, skipped ${skipped}`
  );
  if (!apply) console.log("Dry run — nothing written. Re-run with --apply.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
