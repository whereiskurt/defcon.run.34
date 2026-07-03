/**
 * LOCAL-ONLY seeder (dev): populate GLOBAL overlay folders + routes from the
 * checked-in e2e sample GPX files, so /api/gpx/public/maps returns a manifest
 * to decorate — no GITHUB_TOKEN / prod access needed (cf. import-dc33.ts).
 *
 * Run against local DynamoDB (:8888) + MinIO (:9000):
 *   DYNAMODB_ENDPOINT=http://localhost:8888 DYNAMODB_TABLE=run-gpx-electro \
 *   DYNAMODB_REGION=us-east-1 DYNAMODB_ACCESS_KEY=local DYNAMODB_SECRET_KEY=local \
 *   S3_UPLOADS_ENDPOINT=http://localhost:9000 S3_UPLOADS_BUCKET=run-gpx-uploads \
 *   S3_UPLOADS_REGION=us-east-1 S3_UPLOADS_ACCESS_KEY=minioadmin \
 *   S3_UPLOADS_SECRET_KEY=minioadmin NODE_ENV=development \
 *   npx tsx scripts/seed-local-routes.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { GpxFolder } from "../src/entities/gpx-folder";
import { GpxFile } from "../src/entities/gpx-file";
import { s3Client, BUCKET, getUserPrefix } from "../src/lib/s3-client";

const SAMPLES = join(__dirname, "..", "..", "e2e", "samples");

// A few distinct sample routes → "DEF CON 34 Maps"; a couple → "Rabbit Routes".
const OFFICIAL = [
  "japan.gpx",
  "Test NYC Route.gpx",
  "BT Caledon Hills 2025.gpx",
  "Guelphur Springs 1x20km Loop.gpx",
  "lvcc_indoor.new.gpx",
  "Niagara_Bruce_Trail_FKT_attempt_updated.gpx",
];
const RABBIT = ["Test Japan Route.gpx", "japan.gpx"];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function displayName(fileName: string): string {
  return fileName.replace(/\.gpx$/i, "").replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const R = 6371000;
function haversine(a: [number, number], b: [number, number]): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180, la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function stats(gpx: string) {
  const re = /<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"[^>]*>(?:[\s\S]*?<ele>([-\d.]+)<\/ele>)?/g;
  const pts: [number, number][] = [];
  const eles: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(gpx)) !== null) {
    pts.push([parseFloat(m[1]), parseFloat(m[2])]);
    if (m[3] !== undefined) eles.push(parseFloat(m[3]));
  }
  let dist = 0, gain = 0;
  for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1], pts[i]);
  for (let i = 1; i < eles.length; i++) { const d = eles[i] - eles[i - 1]; if (d > 0) gain += d; }
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  const bounds = pts.length
    ? { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) }
    : undefined;
  return { dist: Math.round(dist), gain: Math.round(gain), bounds };
}

async function importInto(folderName: string, files: string[]) {
  const folderId = `seed-${slug(folderName)}`;
  await GpxFolder.put({
    userId: "GLOBAL", folderId, folderName, parentFolderId: "ROOT",
    depth: 0, isGlobal: true, createdBy: "seed-local",
  }).go();
  console.log(`＋ folder "${folderName}" (${folderId})`);
  const fslug = slug(folderName);
  for (const f of files) {
    const gpx = readFileSync(join(SAMPLES, f), "utf8");
    const fileId = `${fslug}-${slug(f.replace(/\.gpx$/i, ""))}`;
    const key = `${getUserPrefix("GLOBAL")}${fileId}.gpx`;
    const { dist, gain, bounds } = stats(gpx);
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: gpx, ContentType: "application/gpx+xml",
    }));
    await GpxFile.put({
      userId: "GLOBAL", fileId, fileName: `${displayName(f)}.gpx`,
      bucket: BUCKET, key, fileSize: Buffer.byteLength(gpx),
      trackCount: 1, totalDistance: dist, totalElevation: gain, bounds,
      folderId, source: "upload", publicShareEligible: true,
      uploadedBy: "seed-local", status: "active",
    }).go();
    console.log(`＋ [${folderName}] "${displayName(f)}" (${(dist / 1000).toFixed(1)}km, +${gain}m)`);
  }
}

async function main() {
  await importInto("DEF CON 34 Maps", OFFICIAL);
  await importInto("Rabbit Routes", RABBIT);
  console.log("Done seeding local GLOBAL overlay routes.");
}

main().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
