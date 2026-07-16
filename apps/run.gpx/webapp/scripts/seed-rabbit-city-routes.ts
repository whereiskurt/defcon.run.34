/**
 * Curate the "Rabbit Routes" GLOBAL overlay folder: the runners actually run the
 * New York (Manhattan) and Japan (Tokyo) city tracks, so show those and retire the
 * placeholder Vegas samples. PUT-only (run-gpx IAM user is PutItem-only) — the
 * placeholders are hidden via status:"inactive" (the public overlay serves only
 * status:"active"), the two city routes are put active.
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

// Placeholder samples currently in the folder — retire them.
const PLACEHOLDERS = [
  { fileId: "rabbit-routes-bigstar_391f53c473", fileName: "Bigstar.gpx" },
  { fileId: "rabbit-routes-east_e3977557f2", fileName: "East.gpx" },
  { fileId: "rabbit-routes-frankie_46f4770c5a", fileName: "Frankie.gpx" },
  { fileId: "82198119-c9f1-453d-812d-dc5775d4a249", fileName: "Day 1.gpx" },
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

  for (const p of PLACEHOLDERS) {
    await GpxFile.put({
      userId: "GLOBAL", fileId: p.fileId, fileName: p.fileName, bucket: BUCKET,
      key: `${getUserPrefix("GLOBAL")}${p.fileId}.gpx`, fileSize: 1,
      folderId: FOLDER_ID, uploadedBy: "rabbit-city-seed", status: "inactive",
    }).go();
    console.log(`－ retired placeholder "${p.fileName}"`);
  }
  console.log("Done curating Rabbit Routes → New York + Japan.");
}

main().catch((err) => { console.error("seed failed:", err); process.exit(1); });
