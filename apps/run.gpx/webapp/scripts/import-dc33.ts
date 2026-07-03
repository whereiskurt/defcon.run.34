/**
 * DC33 archive importer (v1.7) — seed last year's public GPX routes.
 *
 * Pulls every .gpx from github.com/whereiskurt/defcon.run.33/apps/strapi/s3backup and
 * imports each as an active GLOBAL GpxFile in a "DC33 Archive" folder, so they render as
 * individually-toggleable routes in the public overlay (Phase 28). Idempotent by fileName.
 *
 * Ops script — run with the app's AWS creds + a GitHub token that can read the DC33 repo:
 *   GITHUB_TOKEN=... DYNAMODB_TABLE=dc34-gpx DYNAMODB_REGION=us-east-1 \
 *   DYNAMODB_ACCESS_KEY=... DYNAMODB_SECRET_KEY=... \
 *   S3_UPLOADS_BUCKET=... S3_UPLOADS_ACCESS_KEY=... S3_UPLOADS_SECRET_KEY=... \
 *   npx tsx scripts/import-dc33.ts
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { GpxFolder } from "../src/entities/gpx-folder";
import { GpxFile } from "../src/entities/gpx-file";
import { s3Client, BUCKET, getUserPrefix } from "../src/lib/s3-client";

const REPO = "whereiskurt/defcon.run.33";
const DIR = "apps/strapi/s3backup";
const FOLDER_NAME = "DC33 Archive";
const GH = "https://api.github.com";

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

async function ensureFolder(): Promise<string> {
  const existing = await GpxFolder.query.byUser({ userId: "GLOBAL" }).go();
  const match = existing.data.find(
    (f) => f.folderName.toLowerCase() === FOLDER_NAME.toLowerCase()
  );
  if (match) return match.folderId;
  const folderId = uuidv4();
  await GpxFolder.create({
    userId: "GLOBAL",
    folderId,
    folderName: FOLDER_NAME,
    parentFolderId: "ROOT",
    depth: 0,
    isGlobal: true,
    createdBy: "dc33-import",
  }).go();
  console.log(`＋ created GLOBAL folder "${FOLDER_NAME}" (${folderId})`);
  return folderId;
}

async function main() {
  const folderId = await ensureFolder();

  // Dedupe by display name within the folder.
  const existing = await GpxFile.query.byFolder({ userId: "GLOBAL", folderId }).go({ pages: "all" });
  const have = new Set(existing.data.map((f) => f.fileName.toLowerCase()));

  const files = await listGpx();
  console.log(`Found ${files.length} DC33 GPX files.`);
  let imported = 0;

  for (const f of files) {
    const name = `${displayName(f.name)}.gpx`;
    if (have.has(name.toLowerCase())) {
      console.log(`= skip "${name}" (already imported)`);
      continue;
    }
    const gpx = await fetchGpx(f.path);
    const fileId = uuidv4();
    const key = `${getUserPrefix("GLOBAL")}${fileId}.gpx`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: gpx,
        ContentType: "application/gpx+xml",
      })
    );
    await GpxFile.create({
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
    console.log(`＋ imported "${name}"`);
    imported++;
  }
  console.log(`Done. Imported ${imported}/${files.length} into "${FOLDER_NAME}".`);
}

main().catch((err) => {
  console.error("DC33 import failed:", err);
  process.exit(1);
});
