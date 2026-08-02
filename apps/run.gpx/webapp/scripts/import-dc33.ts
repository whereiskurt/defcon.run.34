/**
 * DC33 archive importer (v1.7) — seed last year's public GPX routes.
 *
 * Pulls every .gpx from github.com/whereiskurt/defcon.run.33/apps/strapi/s3backup and
 * imports each as an active GLOBAL GpxFile in a "DC33 Archive" folder, so they render as
 * individually-toggleable routes in the public overlay (Phase 28). Idempotent by fileName.
 *
 * Ops script — run with the run-gpx app's AWS creds (from SSM) + a GitHub token that can
 * read the DC33 repo. NOTE: the real table is `run-gpx-electro` (the entity's "dc34-gpx"
 * default is dev-only), the bucket is `uploads-dc34-run-gpx-use1-<suffix>`, and the scoped
 * run-gpx IAM user is PutItem-only on the table — hence deterministic ids + `put` upserts,
 * no reads. Verified against prod 2026-07-03 (15 → "DEF CON 34 Maps", 3 → "Rabbit Routes").
 *   GITHUB_TOKEN=... DYNAMODB_TABLE=run-gpx-electro DYNAMODB_REGION=us-east-1 \
 *   DYNAMODB_ACCESS_KEY=... DYNAMODB_SECRET_KEY=... \
 *   S3_UPLOADS_BUCKET=... S3_UPLOADS_ACCESS_KEY=... S3_UPLOADS_SECRET_KEY=... \
 *   npx tsx scripts/import-dc33.ts
 *
 * ⚠️ RE-RUNNING THIS REVERTS A HAND-APPLIED PROD FIX (2026-08-02).
 * Three routes — north_5276453c29, south_0b4e77ffac, west_4ba676aaaa — arrived from DC33
 * as route-only GPX (`<rte>/<rtept>`, creator Aspose.Gis, no `<trk>`). Garmin devices do
 * not render those, and `boundsOf()` below returns undefined for them, so their overlay
 * layers could not fit-to-bounds. They were converted to `<trk>/<trkseg>/<trkpt>` by hand
 * and written straight into prod S3 + DynamoDB; the geometry is unchanged, only the
 * container. The upstream DC33 repo still serves the BROKEN originals, and the deterministic
 * fileId means the `put` below is an upsert — so an unguarded re-import silently restores
 * the route-only versions. Before re-running, either re-apply those three files afterwards
 * (originals are backed up at uploads/GLOBAL/gpx/_backup-rte-20260802/) or fix them upstream.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { GpxFolder } from "../src/entities/gpx-folder";
import { GpxFile } from "../src/entities/gpx-file";
import { s3Client, BUCKET, getUserPrefix } from "../src/lib/s3-client";

const REPO = "whereiskurt/defcon.run.33";
const DIR = "apps/strapi/s3backup";
const GH = "https://api.github.com";

// DC34 seeds from DC33 to start: all last-year routes → "DEF CON 34 Maps".
// "Rabbit Routes" gets a few community samples (Vegas-area runs) to seed the group.
const OFFICIAL_FOLDER = "DEF CON 34 Maps";
const RABBIT_FOLDER = "Rabbit Routes";
const RABBIT_SAMPLE_COUNT = 3;

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

async function listGpx(): Promise<{ name: string; path: string }[]> {
  const res = await fetch(`${GH}/repos/${REPO}/contents/${DIR}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  const items = (await res.json()) as { name: string; path: string; type: string }[];
  return items.filter((i) => i.type === "file" && i.name.endsWith(".gpx"));
}

async function fetchGpx(path: string): Promise<string> {
  const res = await fetch(`${GH}/repos/${REPO}/contents/${path}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`fetch ${path} failed: ${res.status}`);
  const body = (await res.json()) as { content: string; encoding: string };
  return Buffer.from(body.content, "base64").toString("utf8");
}

// "bigstar_391f53c473.gpx" -> "Bigstar"
function displayName(fileName: string): string {
  const base = fileName.replace(/\.gpx$/i, "").replace(/_[a-f0-9]{6,}$/i, "");
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// NOTE: matches `<trkpt>` ONLY. A route-only GPX (`<rte>/<rtept>`) or a waypoint-only one
// (`<wpt>`) yields zero points here, so `bounds` lands undefined and the public overlay
// serves that route with a null bounds — it renders, but cannot fit-to-bounds. This bit
// north/south/west (see the header warning) and still affects history_7cd9eb0707, which is
// waypoint-only. Widening the regex is safe for bounds, but do not assume it fixes
// `trackCount` (hardcoded to 1 below) or the distance/elevation fields (never computed —
// totalDistance/totalElevation are 0 on every imported route).
function boundsOf(gpx: string) {
  const re = /<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"/g;
  let m: RegExpExecArray | null;
  const lats: number[] = [];
  const lons: number[] = [];
  while ((m = re.exec(gpx)) !== null) {
    lats.push(parseFloat(m[1]));
    lons.push(parseFloat(m[2]));
  }
  if (lats.length === 0) return undefined;
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// PUT-ONLY (the run-gpx IAM user allows PutItem but not GetItem/gsi2 Query).
// Deterministic folderId + upsert → idempotent with no reads.
async function ensureFolder(folderName: string): Promise<string> {
  const folderId = `seed-${slug(folderName)}`;
  await GpxFolder.put({
    userId: "GLOBAL",
    folderId,
    folderName,
    parentFolderId: "ROOT",
    depth: 0,
    isGlobal: true,
    createdBy: "dc33-import",
  }).go();
  console.log(`＋ folder "${folderName}" (${folderId})`);
  return folderId;
}

async function importInto(
  folderName: string,
  files: { name: string; path: string }[]
): Promise<void> {
  const folderId = await ensureFolder(folderName);
  const fslug = slug(folderName);
  let imported = 0;
  for (const f of files) {
    const name = `${displayName(f.name)}.gpx`;
    // Deterministic fileId per (folder, source) → `put` is an idempotent upsert.
    const fileId = `${fslug}-${f.name.replace(/\.gpx$/i, "")}`;
    const gpx = await fetchGpx(f.path);
    const key = `${getUserPrefix("GLOBAL")}${fileId}.gpx`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: gpx,
        ContentType: "application/gpx+xml",
      })
    );
    await GpxFile.put({
      userId: "GLOBAL",
      fileId,
      fileName: name,
      bucket: BUCKET,
      key,
      fileSize: Buffer.byteLength(gpx),
      trackCount: 1,
      bounds: boundsOf(gpx),
      folderId,
      source: "dc33",
      publicShareEligible: true,
      uploadedBy: "dc33-import",
      status: "active",
    }).go();
    console.log(`＋ [${folderName}] imported "${name}"`);
    imported++;
  }
  console.log(`Done "${folderName}": imported ${imported}/${files.length}.`);
}

async function main() {
  const files = await listGpx();
  console.log(`Found ${files.length} DC33 GPX files.`);
  // DC34 = same routes as DC33 to start.
  await importInto(OFFICIAL_FOLDER, files);
  // Seed a few community samples into Rabbit Routes (Vegas-area runs).
  await importInto(RABBIT_FOLDER, files.slice(0, RABBIT_SAMPLE_COUNT));
}

main().catch((err) => {
  console.error("DC33 import failed:", err);
  process.exit(1);
});
