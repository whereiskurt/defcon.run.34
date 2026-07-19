/**
 * backfill-mesh-radios.mts (Phase 66, MRAD-03) — one-off, idempotent, re-runnable
 * backfill that seeds the first-class `MeshRadio` entity from every existing
 * `RunUser.meshtasticRadios[]` embedded entry.
 *
 * WHY this exists: the LOCKED hard-switch (CONTEXT §11) makes `MeshRadio` the sole
 * source of truth and meshtk flips `fallback=none` at deploy time (spec §8). Radios
 * that were registered BEFORE this phase live only in the embedded list; without
 * this backfill they would have no `MeshRadio` row and would MISS under
 * `fallback=none`. This closes that gap so the entity is fully seeded before the flip.
 *
 * ── WHY the raw @aws-sdk client and NOT the ElectroDB entity (L9) ────────────
 * Identical rationale to migrate-ctf-answerhash.mts / reset-ctf-user.mts: the
 * `MeshRadio` entity imports src/entities/client.ts, which imports the ESM-ONLY
 * `@auth/dynamodb-adapter`. Under a bare `tsx` CJS run that `require()` fails with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. So this script talks to DynamoDB via the raw
 * @aws-sdk `DynamoDBDocument` client. It also reads the SOURCE data raw: plan 66-03
 * REMOVED `meshtasticRadios` from the RunUser ElectroDB *entity*, but the attribute
 * still lives on the existing DynamoDB rows — so we scan RunUser rows by their
 * ElectroDB `__edb_e__` marker and read `row.meshtasticRadios` off the raw item.
 *
 * ── Key composition (L1 parity) ─────────────────────────────────────────────
 * Because the entity is unavailable in a bare run, `toMeshRadioItem` HAND-COMPOSES
 * the MeshRadio item — pk/sk/gsi1pk/gsi1sk AND the ElectroDB internal markers
 * (`__edb_e__`/`__edb_v__`) — so an app-side ElectroDB read (getMeshRadiosByUser /
 * scanAllMeshRadios) hydrates a backfilled row identically to a route-written one.
 * These strings are the cross-language contract meshtk (plan 66-07) composes in Go.
 * They are LOCKED against the real entity by scripts/__tests__/backfill-mesh-radios
 * .test.mts, which asserts `toMeshRadioItem(...)` equals `MeshRadio.put(...)
 * .params().Item` field-for-field (the L1 lock — see also
 * src/entities/__tests__/mesh-radio-key-parity.test.ts). NEVER edit the composed
 * strings below without that test going green.
 *
 * ── Conversion / canonicalization (reused from plan 66-02, PURE lib L9) ──────
 *   - publicKey base64 → "0x" hex, guarded to exactly 32 bytes (publicKeyBase64ToHex).
 *     A radio whose key is absent OR fails the guard is SKIPPED + logged (not fatal).
 *   - nodeId → "!" + pad-8 lowercase hex (normalizeNodeId); nodeNum = uint32.
 *
 * SAFETY / hygiene:
 *   - DRY-RUN BY DEFAULT: scans, prints per-radio actions + a summary, writes nothing.
 *     Pass --confirm to actually write.
 *   - Idempotent: GetItem the target MeshRadio first; skip if present ("already
 *     migrated"). The write is additionally a conditional put (attribute_not_exists)
 *     so a race / re-run is last-writer-safe and never clobbers a live row.
 *   - NEVER logs key material (privateKey/publicKey values) — actions/ids only.
 *   - Standalone operator script: NOT imported by any app/request/build path. The
 *     per-radio transform is a PURE exported function (unit-tested without DDB).
 *   - Fails loud (non-zero exit) if the region env is missing BEFORE any scan.
 *
 * Env (same names the webapp uses — see src/entities/client.ts):
 *   RUN_ELECTRO_ID, RUN_ELECTRO_SECRET   (optional; default AWS provider chain if unset)
 *   RUN_DYNAMODB_REGION                  (region — REQUIRED)
 *   RUN_ELECTRO_DBNAME                   (table; default "run-human-electro")
 *   RUN_ELECTRO_ENDPOINT                 (optional; set for LOCAL dynamodb)
 *
 * PROD RUN RECIPE (us-east-1 / shared run-human-electro table):
 *   cd apps/run.human/webapp
 *   # 1. dry-run — inspect the plan (writes nothing):
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/backfill-mesh-radios.mts
 *   # 2. commit the backfill (creates missing MeshRadio rows):
 *   AWS_PROFILE=dc34-application npx tsx --env-file=.env scripts/backfill-mesh-radios.mts --confirm
 *   # 3. (optional) re-run --confirm to prove idempotency — should report all skip.
 * MUST run+backfill MeshRadio BEFORE meshtk flips fallback=none (L7).
 * This is a ONE-TIME, idempotent, safe-to-re-run migration.
 */
import { fileURLToPath } from "node:url";

import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

import {
  normalizeNodeId,
  nodeNumFromNodeId,
  publicKeyBase64ToHex,
} from "../src/lib/mesh-radio-canonical";

const CONFIRM = process.argv.includes("--confirm");
const TABLE = process.env.RUN_ELECTRO_DBNAME || "run-human-electro";
const REGION = process.env.RUN_DYNAMODB_REGION;
const RUNUSER_ENTITY = "RunUser"; // ElectroDB __edb_e__ marker for the RunUser entity

/**
 * The embedded `RunUser.meshtasticRadios[]` map shape (run-user.ts BEFORE plan
 * 66-03 removed the attribute from the entity; the attribute still lives on the
 * raw DynamoDB rows this script scans). Every field is optional on the wire.
 */
export interface EmbeddedRadio {
  id?: string;
  nodeId?: string;
  privateKey?: string;
  publicKey?: string; // base64 (device X25519), converted to 0x-hex here
  impersonate?: boolean;
  showOnMap?: boolean;
  verificationCode?: string;
  verified?: boolean;
  createdAt?: number;
  verifiedAt?: number;
  verificationAttempts?: number;
  resendAttempts?: number;
}

/**
 * A raw, ElectroDB-parity MeshRadio DynamoDB item (what `MeshRadio.put(...).params()
 * .Item` produces). Hand-composed here because the entity is unavailable in a bare
 * tsx run (L9); locked against the entity by the parity test (L1).
 */
export interface MeshRadioRawItem {
  __edb_e__: "MeshRadio";
  __edb_v__: "1";
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  nodeId: string;
  nodeNum: number;
  userId: string;
  publicKey: string;
  privateKey?: string;
  verified: boolean;
  verificationCode?: string;
  verifiedAt?: number;
  verificationAttempts: number;
  resendAttempts: number;
  impersonate: boolean;
  showOnMap: boolean;
  source: "flash" | "sync" | "manual";
  createdAt: number;
  updatedAt: number;
}

/**
 * PURE transform: one embedded radio → a MeshRadio raw item, or `null` to SKIP.
 *
 * Returns `null` (a skip signal) when the radio cannot yield a valid decrypt row:
 *   - no `nodeId` (cannot compose the parity key), or
 *   - `publicKey` absent OR not a 32-byte base64 decode (L3 guard — never persist a
 *     key meshtk's ParseHexKey would reject). A malformed/empty key is NOT fatal to
 *     the run; the caller logs the skip and moves on.
 *
 * Otherwise composes the FULL parity item: canonical pad-8 lowercase nodeId, uint32
 * nodeNum, 0x-hex publicKey, carried-over verification/flags, `source:"manual"`
 * (embedded radios carry no reliable flash marker), original createdAt preserved,
 * updatedAt = now. Unit-tested without DDB.
 */
export function toMeshRadioItem(
  userId: string,
  radio: EmbeddedRadio,
  now: number = Date.now()
): MeshRadioRawItem | null {
  if (!userId || !radio?.nodeId) return null;

  // 0x-hex publicKey with the strict 32-byte guard — skip (not throw) on failure.
  if (!radio.publicKey) return null;
  let publicKey: string;
  try {
    publicKey = publicKeyBase64ToHex(radio.publicKey);
  } catch {
    return null; // present-but-not-32-bytes → skip + log at the call site
  }

  const nodeId = normalizeNodeId(radio.nodeId); // "!" + pad-8 lowercase (L2/L12)
  const nodeNum = nodeNumFromNodeId(nodeId); // uint32

  const item: MeshRadioRawItem = {
    // ── ElectroDB internal markers + composed keys (parity-locked, L1) ──
    __edb_e__: "MeshRadio",
    __edb_v__: "1",
    pk: "$run#nodeid_" + nodeId,
    sk: "$meshradio_1",
    gsi1pk: "$run#userid_" + userId,
    gsi1sk: "$meshradio_1#nodeid_" + nodeId,
    // ── modeled attributes ──
    nodeId,
    nodeNum,
    userId,
    publicKey,
    verified: radio.verified ?? false,
    verificationAttempts: radio.verificationAttempts ?? 0,
    resendAttempts: radio.resendAttempts ?? 0,
    impersonate: radio.impersonate ?? false,
    showOnMap: radio.showOnMap ?? false,
    source: "manual",
    createdAt: radio.createdAt ?? now, // preserve the original create time
    updatedAt: now,
    // optional attributes: only include when present (keeps the item clean; the
    // doc client's removeUndefinedValues would strip them on write anyway).
    ...(radio.privateKey ? { privateKey: radio.privateKey } : {}),
    ...(radio.verificationCode ? { verificationCode: radio.verificationCode } : {}),
    ...(radio.verifiedAt != null ? { verifiedAt: radio.verifiedAt } : {}),
  };
  return item;
}

// ─────────────────────────────────────────────────────────────────────────────
// Below: the DDB I/O harness (not imported by tests — guarded at the bottom).
// ─────────────────────────────────────────────────────────────────────────────

interface RunUserRow {
  pk: string;
  sk: string;
  userId?: string;
  meshtasticRadios?: EmbeddedRadio[];
}

/** BOTH RUN_ELECTRO_ID+SECRET → explicit creds (local); else the default AWS
 * provider chain so `AWS_PROFILE=dc34-application` (SSO) drives a prod run. */
function creds() {
  const id = process.env.RUN_ELECTRO_ID;
  const secret = process.env.RUN_ELECTRO_SECRET;
  return id && secret
    ? { credentials: { accessKeyId: id, secretAccessKey: secret } }
    : {};
}

function makeDoc() {
  return DynamoDBDocument.from(
    new DynamoDB({
      region: REGION,
      ...creds(),
      ...(process.env.RUN_ELECTRO_ENDPOINT
        ? { endpoint: process.env.RUN_ELECTRO_ENDPOINT }
        : {}),
    }),
    { marshallOptions: { removeUndefinedValues: true } }
  );
}

/** Scan every RunUser row (paginated), filtered to the ElectroDB entity marker. */
async function scanRunUsers(
  doc: DynamoDBDocument
): Promise<RunUserRow[]> {
  const items: RunUserRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.scan({
      TableName: TABLE,
      FilterExpression: "#e = :e",
      ExpressionAttributeNames: { "#e": "__edb_e__" },
      ExpressionAttributeValues: { ":e": RUNUSER_ENTITY },
      ExclusiveStartKey,
    });
    items.push(...((r.Items as RunUserRow[]) || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  if (!REGION) {
    console.error("Missing required env var: RUN_DYNAMODB_REGION");
    process.exit(2);
  }

  console.log(
    `Table: ${TABLE}  Region: ${REGION}  Endpoint: ${
      process.env.RUN_ELECTRO_ENDPOINT || "(aws)"
    }  Mode: ${CONFIRM ? "WRITE" : "DRY-RUN"}`
  );

  const doc = makeDoc();
  const rows = await scanRunUsers(doc);
  console.log(`Scanned ${rows.length} RunUser rows.\n`);

  const counts = {
    usersWithRadios: 0,
    radiosFound: 0,
    created: 0,
    skippedExisting: 0,
    skippedMalformed: 0,
    errors: 0,
  };

  for (const row of rows) {
    const radios = row.meshtasticRadios;
    if (!Array.isArray(radios) || radios.length === 0) continue;
    // The owning userId is the RunUser's own primary key attribute (read from the
    // scanned row — never composed), which is exactly the MeshRadio.byUser partition.
    const userId = row.userId;
    if (!userId) {
      console.log(`  ! RunUser ${row.pk} has radios but no userId — skipping row`);
      continue;
    }
    counts.usersWithRadios += 1;

    for (const radio of radios) {
      counts.radiosFound += 1;
      const item = toMeshRadioItem(userId, radio);
      if (!item) {
        counts.skippedMalformed += 1;
        console.log(
          `  - ${radio?.nodeId ?? "(no nodeId)"} → skip (missing/invalid pubkey)`
        );
        continue;
      }

      // Idempotency: get-first short-circuit.
      try {
        const existing = await doc.get({
          TableName: TABLE,
          Key: { pk: item.pk, sk: item.sk },
        });
        if (existing.Item) {
          counts.skippedExisting += 1;
          console.log(`  = ${item.nodeId} → already migrated (skip)`);
          continue;
        }
      } catch (e) {
        counts.errors += 1;
        console.log(`  ! ${item.nodeId} → get failed: ${(e as Error).message}`);
        continue;
      }

      if (!CONFIRM) {
        counts.created += 1; // "would create" in dry-run
        console.log(`  + ${item.nodeId} → would create (user ${userId})`);
        continue;
      }

      try {
        // Conditional put: last-writer-safe — a concurrent create wins, we no-op.
        await doc.put({
          TableName: TABLE,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk)",
        });
        counts.created += 1;
        console.log(`  + ${item.nodeId} → created (user ${userId})`);
      } catch (e) {
        const name = (e as { name?: string }).name;
        if (name === "ConditionalCheckFailedException") {
          counts.skippedExisting += 1;
          console.log(`  = ${item.nodeId} → created concurrently (skip)`);
        } else {
          counts.errors += 1;
          console.log(`  ! ${item.nodeId} → put failed: ${(e as Error).message}`);
        }
      }
    }
  }

  const verb = CONFIRM ? "Created" : "Would create";
  console.log(
    `\nScanned ${rows.length} users (${counts.usersWithRadios} with radios), ` +
      `${counts.radiosFound} radios found.\n` +
      `${verb}: ${counts.created}  |  skipped-existing: ${counts.skippedExisting}  |  ` +
      `skipped-malformed: ${counts.skippedMalformed}  |  errors: ${counts.errors}.`
  );
  if (!CONFIRM) {
    console.log("Re-run with --confirm to write.");
  }
}

// Run ONLY when invoked as a script (`tsx scripts/backfill-mesh-radios.mts`), never
// when imported by the unit test — so importing `toMeshRadioItem` triggers no scan.
const RUN_AS_SCRIPT =
  !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (RUN_AS_SCRIPT) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
