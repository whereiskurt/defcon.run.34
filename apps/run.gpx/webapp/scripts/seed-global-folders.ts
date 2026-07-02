/**
 * Seed the public GLOBAL overlay folders (v1.7 Phase 28).
 *
 * Idempotently ensures the "DEF CON 34 Maps" GLOBAL folder exists (userId="GLOBAL",
 * isGlobal=true) so the public overlay endpoint has a collection to serve. Admins then
 * publish routes into it (Phase 29). "Rabbit Routes" is seeded in Phase 30.
 *
 * Run against the target DynamoDB (same env as the app):
 *   DYNAMODB_TABLE=dc34-gpx DYNAMODB_REGION=us-east-1 \
 *   DYNAMODB_ACCESS_KEY=... DYNAMODB_SECRET_KEY=... \
 *   npx tsx scripts/seed-global-folders.ts
 */
import { v4 as uuidv4 } from "uuid";
import { GpxFolder } from "../src/entities/gpx-folder";

const GLOBAL_FOLDERS = ["DEF CON 34 Maps", "Rabbit Routes"];

async function ensureGlobalFolder(folderName: string): Promise<void> {
  const existing = await GpxFolder.query.byUser({ userId: "GLOBAL" }).go();
  const match = existing.data.find(
    (f) => f.folderName.toLowerCase() === folderName.toLowerCase()
  );
  if (match) {
    console.log(`✓ "${folderName}" already exists (folderId=${match.folderId})`);
    return;
  }
  const folderId = uuidv4();
  await GpxFolder.create({
    userId: "GLOBAL",
    folderId,
    folderName,
    parentFolderId: "ROOT",
    depth: 0,
    isGlobal: true,
    createdBy: "seed-script",
  }).go();
  console.log(`＋ created "${folderName}" (folderId=${folderId})`);
}

async function main() {
  for (const name of GLOBAL_FOLDERS) {
    await ensureGlobalFolder(name);
  }
  console.log("Done seeding GLOBAL overlay folders.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
