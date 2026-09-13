/**
 * add-global-route.ts — publish one GPX as a permanent public overlay route.
 *
 * WHAT THIS IS FOR. The "DEF CON 34 ROUTES" group in the studio's Map Layers
 * panel is not code — it is whatever `GET /api/gpx/public/maps` finds under the
 * GLOBAL partition. That endpoint queries every `userId="GLOBAL"` GpxFolder and
 * returns its `status:"active"` GpxFile rows, then enriches each with a Strapi
 * Route matched on `gpxFileId`. So adding an official route is a DATA change to
 * prod DynamoDB + S3; no app build or deploy is involved.
 *
 * The original 15 arrived via `import-dc33.ts`, which pulls from a GitHub repo
 * and cannot add a route that has no DC33 ancestor. This script is the forward
 * path for a NEW permanent route authored for DC34.
 *
 * GEOMETRY IS DERIVED HERE, NEVER TAKEN ON TRUST. trackCount, waypointCount,
 * totalDistance, totalElevation and bounds all come from `summarizeGpxText`
 * parsing the bytes we are about to upload — the same helper the upload-confirm
 * seam uses. A GPX's own <metadata> distance claim is ignored. (import-dc33.ts
 * hardcoded trackCount:1 and never computed distance at all, which is why every
 * imported route sat at totalDistance 0 until the 2026-08-07 backfill.)
 *
 * LIST POSITION IS `createdAt`, NOT NAME. The public manifest returns rows in
 * the byFolder GSI's sort order — `folderId#createdAt` — and the studio renders
 * that order as-is. To place a route between two existing ones, pass a
 * --created-at between their timestamps. Omit it and the route lands last.
 *
 * CREDENTIALS. The entities build their AWS clients from DYNAMODB_ACCESS_KEY /
 * S3_UPLOADS_ACCESS_KEY pairs with NO session token, so an SSO profile's
 * temporary credentials will not work. Use the same scoped IAM user the ECS
 * task uses, out of SSM:
 *
 *   /dc34/dynamodb/use1/run-gpx-electro/{access_key_id,secret_access_key,table_name}
 *   /dc34/uploads/use1/run-gpx/{access_key_id,secret_access_key,bucket_name}
 *
 * That user is PutItem-only on the table (no GetItem, no Query), which is why
 * the existence check below is best-effort and `--force` exists.
 *
 * INVOCATION — from `apps/run.gpx/webapp`, with the env above exported:
 *
 *   # dry run: parses + summarizes, prints the exact row, writes nothing
 *   npx tsx scripts/add-global-route.ts \
 *     --file scripts/data/sign-2.0.gpx \
 *     --name "Sign 2.0" \
 *     --file-id def-con-34-maps-sign20 \
 *     --created-at 1783084207900
 *
 *   # apply
 *   ... --apply
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. --apply is required to write anything.
 *   - Refuses a GPX with no <trkpt>. A route-only (<rte>) or waypoint-only file
 *     yields no bounds, cannot fit-to-bounds in the studio, and does not render
 *     on Garmin — the exact defect three DC33 routes shipped with.
 *   - Refuses to overwrite an existing fileId unless --force. The `put` is an
 *     upsert, so an unguarded re-run would silently replace a live route.
 *   - --help exits 0 without touching the network.
 *
 * AFTERWARDS. The route renders with its filename as the label and a palette
 * color. To give it a title, tooltip, curated distance and line color like the
 * other 15, create a published Strapi Route whose `gpxFileId` equals --file-id.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { GpxFile } from "../src/entities/gpx-file";
import { GpxFolder } from "../src/entities/gpx-folder";
import { s3Client, BUCKET, getUserPrefix } from "../src/lib/s3-client";
import { summarizeGpxText } from "../src/lib/route-summary";
import { readFileSync } from "node:fs";

/** The GLOBAL folder holding the official DC34 overlay routes. */
const DEFAULT_FOLDER_ID = "seed-def-con-34-maps";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function usage(): never {
  console.log(
    `
add-global-route — publish a GPX as a permanent public overlay route.

  --file       <path>  GPX file to upload (required)
  --name       <text>  Display name, e.g. "Sign 2.0" (required). Stored as
                       "<name>.gpx"; the studio strips the extension for the
                       layer label unless a CMS Route supplies a title.
  --file-id    <id>    Deterministic GpxFile id / S3 object name (required).
                       Convention: def-con-34-maps-<slug>
  --folder-id  <id>    GLOBAL folder to publish into (default ${DEFAULT_FOLDER_ID})
  --created-at <ms>    Epoch ms controlling list position. Default: now (last).
  --source     <text>  Provenance tag on the row (default "official")
  --apply              write; omit for a dry run
  --force              allow overwriting an existing fileId
  --help               this text

Requires DYNAMODB_* and S3_UPLOADS_* env (see the header).
`.trim()
  );
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--help")) usage();

  const file = arg("file");
  const name = arg("name");
  const fileId = arg("file-id");
  const folderId = arg("folder-id") ?? DEFAULT_FOLDER_ID;
  const source = arg("source") ?? "official";
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  if (!file || !name || !fileId) {
    console.error("ERROR: --file, --name and --file-id are all required. --help for usage.");
    process.exit(1);
  }
  if (!BUCKET) {
    console.error("ERROR: S3_UPLOADS_BUCKET is not set.");
    process.exit(1);
  }

  const createdAtArg = arg("created-at");
  const createdAt = createdAtArg ? Number(createdAtArg) : Date.now();
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    console.error(`ERROR: --created-at must be epoch ms, got "${createdAtArg}".`);
    process.exit(1);
  }

  const gpx = readFileSync(file, "utf8");
  const summary = summarizeGpxText(gpx);

  // A file with no track points has no bounds, so the studio cannot fit-to-bounds
  // and Garmin will not render it. Fail loud rather than publish a broken route.
  if (!summary.bounds) {
    console.error(
      `ERROR: ${file} contains no <trkpt> — nothing to render. ` +
        `Convert <rte>/<rtept> to <trk>/<trkseg>/<trkpt> before publishing.`
    );
    process.exit(1);
  }

  const fileName = `${name}.gpx`;
  const key = `${getUserPrefix("GLOBAL")}${fileId}.gpx`;

  console.log(`${apply ? "APPLY" : "DRY RUN"} · bucket=${BUCKET}`);
  console.log(`  file          ${file} (${Buffer.byteLength(gpx)} bytes)`);
  console.log(`  fileId        ${fileId}`);
  console.log(`  fileName      ${fileName}`);
  console.log(`  folderId      ${folderId}`);
  console.log(`  key           ${key}`);
  console.log(`  createdAt     ${createdAt}  (${new Date(createdAt).toISOString()})`);
  console.log(`  trackCount    ${summary.trackCount}`);
  console.log(`  waypointCount ${summary.waypointCount}`);
  console.log(`  totalDistance ${summary.totalDistance} m`);
  console.log(`  totalElevation ${summary.totalElevation} m`);
  console.log(`  bounds        ${JSON.stringify(summary.bounds)}`);

  // Best-effort collision check. The scoped ops IAM user has no GetItem, so a
  // permissions error here is expected and must NOT be read as "does not exist"
  // — that is what --force is for.
  let collision: string | undefined;
  try {
    const existing = await GpxFile.get({ userId: "GLOBAL", fileId }).go();
    if (existing.data) collision = existing.data.fileName;
  } catch {
    console.log(`  (existence check unavailable — no GetItem on this credential)`);
  }
  if (collision && !force) {
    console.error(
      `\nERROR: fileId "${fileId}" already exists as "${collision}". ` +
        `The put below is an upsert and would replace it. Pass --force if that is intended.`
    );
    process.exit(1);
  }

  // Confirm the destination folder is a real GLOBAL folder when we can read it.
  // Same caveat as above: a read failure is not evidence of absence.
  try {
    const folders = await GpxFolder.query.byUser({ userId: "GLOBAL" }).go();
    const match = folders.data.find((f) => f.folderId === folderId);
    if (folders.data.length > 0 && !match) {
      console.error(
        `\nERROR: no GLOBAL folder "${folderId}". Known: ` +
          folders.data.map((f) => `${f.folderId} ("${f.folderName}")`).join(", ")
      );
      process.exit(1);
    }
    if (match) console.log(`  folder        "${match.folderName}" ✓`);
  } catch {
    console.log(`  (folder check unavailable — no Query on this credential)`);
  }

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply.`);
    return;
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: gpx,
      ContentType: "application/gpx+xml",
    })
  );
  console.log(`\n＋ s3://${BUCKET}/${key}`);

  await GpxFile.put({
    userId: "GLOBAL",
    fileId,
    fileName,
    bucket: BUCKET,
    key,
    fileSize: Buffer.byteLength(gpx),
    createdAt,
    trackCount: summary.trackCount,
    waypointCount: summary.waypointCount,
    totalDistance: summary.totalDistance,
    totalElevation: summary.totalElevation,
    bounds: summary.bounds,
    folderId,
    source,
    publicShareEligible: true,
    uploadedBy: "add-global-route",
    status: "active",
  }).go();
  console.log(`＋ GpxFile GLOBAL/${fileId}`);
  console.log(
    `\nDone. The manifest caches for 300s (s-maxage) — allow ~5 min, or invalidate\n` +
      `/use1/api/gpx/public/maps on the run.gpx CloudFront distribution.`
  );
}

main().catch((err) => {
  console.error("add-global-route failed:", err);
  process.exit(1);
});
