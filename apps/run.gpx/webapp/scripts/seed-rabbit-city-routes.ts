/**
 * Curate the "Rabbit Routes" GLOBAL overlay folder: the runners actually run the
 * New York (Manhattan) and Japan (Tokyo) city tracks, so put those active. The 4
 * placeholder Vegas samples (rabbit-routes-bigstar/east/frankie + Day 1) were
 * removed out-of-band via DynamoDB DeleteItem + S3 rm (the run-gpx IAM user is
 * PutItem-only; the "active/pending/failed" status enum has no hide value).
 *
 *   source scratch/gpx.env   # run-gpx DynamoDB/S3 creds from SSM
 *   npx tsx scripts/seed-rabbit-city-routes.ts
 */
import { readFileSync } from "fs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { GpxFile } from "../src/entities/gpx-file";
import { s3Client, BUCKET, getUserPrefix } from "../src/lib/s3-client";

const FOLDER_ID = "seed-rabbit-routes";

const NEW_ROUTES = [
  { fileId: "seed-rabbit-routes-newyork", name: "New York.gpx", file: "manhatten.gpx" },
  { fileId: "seed-rabbit-routes-japan", name: "Japan.gpx", file: "japan.gpx" },
];

function boundsOf(gpx: string) {
  const re = /\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"|\blon="([-\d.]+)"[^>]*\blat="([-\d.]+)"/g;
  const lats: number[] = [];
  const lons: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(gpx)) !== null) {
    if (m[1]) { lats.push(parseFloat(m[1])); lons.push(parseFloat(m[2])); }
    else { lats.push(parseFloat(m[4])); lons.push(parseFloat(m[3])); }
  }
  if (!lats.length) return undefined;
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) };
}

async function main() {
  for (const r of NEW_ROUTES) {
    const gpx = readFileSync(
      new URL(`../../../run.mqtt/meshtk/internal/embedded/gpx/city/${r.file}`, import.meta.url),
      "utf8"
    );
    const key = `${getUserPrefix("GLOBAL")}${r.fileId}.gpx`;
    await s3Client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: gpx, ContentType: "application/gpx+xml" }));
    await GpxFile.put({
      userId: "GLOBAL", fileId: r.fileId, fileName: r.name, bucket: BUCKET, key,
      fileSize: Buffer.byteLength(gpx), trackCount: 1, bounds: boundsOf(gpx),
      folderId: FOLDER_ID, source: "rabbit-city", publicShareEligible: true,
      uploadedBy: "rabbit-city-seed", status: "active",
    }).go();
    console.log(`＋ added "${r.name}" to Rabbit Routes`);
  }
  console.log("Done: Rabbit Routes → New York + Japan (placeholders removed via DeleteItem).");
}

main().catch((err) => { console.error("seed failed:", err); process.exit(1); });
