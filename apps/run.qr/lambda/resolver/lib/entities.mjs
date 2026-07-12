/**
 * ElectroDB entities for the q.defcon.run QR resolver Lambda.
 *
 * These entities live on the SHARED `run-human-electro` table (single-table
 * design, `service: "run"`), alongside run.human and run.bib. The resolver only
 * READS `Qr`/`Ctf` on the hot path; the rollup Lambda (a sibling package) owns
 * writes to `Qrstat`. This file mirrors the style of
 * `apps/run.bib/lambda/reconcile/lib/entities.mjs` (cold-start-cached client,
 * docstring-heavy) and the index/field-name conventions of the webapp entities
 * under `apps/run.bib/webapp/src/entities/*.ts`.
 *
 * Load-bearing contract: PK/SK encoding is derived by ElectroDB from
 * `service` + `entity` + `version` + the composite key attributes, and from the
 * table field names (`pk`/`sk`, `gsi1pk`/`gsi1sk`). The shared table's schema is
 * fixed in `infra/terraform/modules/dynamodb/v1.0.0/main.tf` (`electro` type):
 * hash_key=`pk`, range_key=`sk`, plus `gsi{1,2,3}pk-gsi{1,2,3}sk-index` GSIs.
 * Index `field:` names below MUST match those exactly or writes/queries fail.
 */

import { Entity } from "electrodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// ---------------------------------------------------------------------------
// Shared DynamoDB client
// ---------------------------------------------------------------------------

/**
 * Cold-start-cached DynamoDB Document client. The Lambda runtime shares a
 * single client across warm invocations, so we init once at module load. The
 * resolver's IAM role grants GetItem/Query on the shared table + its GSIs.
 */
export const ddbClient = DynamoDBDocument.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || process.env.REGION_LABEL || "us-east-1",
  }),
  {
    marshallOptions: {
      convertEmptyValues: true,
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
  }
);

/**
 * Shared electro table name. Populated at deploy time via the resolver
 * Lambda's `environment.RUN_ELECTRO_DBNAME`; falls back to the well-known
 * prod table name for local tests.
 */
export const ELECTRO_TABLE =
  process.env.RUN_ELECTRO_DBNAME || "run-human-electro";

// ---------------------------------------------------------------------------
// Qr
// ---------------------------------------------------------------------------

/**
 * Qr entity — one row per short code (spec §5.1). Keyed by the UPPERCASED code
 * (`code`, e.g. "BUNNY"); the resolver GetItems it per scan. A HASH+RANGE
 * primary with an empty SK gives a single row per code.
 *
 * `rules` is intentionally a loose list-of-maps: entries vary by kind
 * ({kind:"time",from,to,dest} or {kind:"param",match,dest}), so the map's
 * properties are declared permissively (all optional strings) rather than a
 * discriminated union ElectroDB can't express. resolveDestination() in
 * lib/rules.mjs owns the semantics.
 *
 * `enrich` is a map: {preserveQuery, appendParam, utm:{source,medium,campaign}}.
 *
 * GSI `byOwner` (gsi1) lets an admin list every code an owner created, newest
 * first (gsi1sk = updatedAt).
 */
export const Qr = new Entity(
  {
    model: {
      entity: "Qr",
      version: "1",
      service: "run",
    },
    attributes: {
      code: { type: "string", required: true },
      type: { type: "string", default: "redirect" },
      destination: { type: "string" },
      // Loose list-of-maps: rule entries differ by `kind` (time vs param).
      // All sub-properties optional so either shape validates.
      rules: {
        type: "list",
        items: {
          type: "map",
          properties: {
            kind: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            match: { type: "string" },
            dest: { type: "string" },
          },
        },
      },
      enrich: {
        type: "map",
        properties: {
          preserveQuery: { type: "boolean" },
          appendParam: { type: "boolean" },
          utm: {
            type: "map",
            properties: {
              source: { type: "string" },
              medium: { type: "string" },
              campaign: { type: "string" },
            },
          },
        },
      },
      enabled: { type: "boolean", default: true },
      owner: { type: "string" },
      notes: { type: "string" },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*",
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["code"] },
        sk: { field: "sk", composite: [] },
      },
      // Admin listing: every code for an owner, ordered by updatedAt.
      byOwner: {
        index: "gsi1pk-gsi1sk-index",
        pk: { field: "gsi1pk", composite: ["owner"] },
        sk: { field: "gsi1sk", composite: ["updatedAt"] },
      },
    },
  },
  { client: ddbClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// Ctf
// ---------------------------------------------------------------------------

/**
 * Ctf entity — one row per challenge (spec §5.2). Keyed by `challenge`. The
 * resolver never validates answers (that's the run.human CTF claim endpoint's
 * job); this shape exists so the resolver/rollup packages share one schema
 * source. `effect` is a permissive map (payload varies by challenge).
 */
export const Ctf = new Entity(
  {
    model: {
      entity: "Ctf",
      version: "1",
      service: "run",
    },
    attributes: {
      challenge: { type: "string", required: true },
      answer: { type: "string" },
      points: { type: "number" },
      // Permissive: effect payload shape varies per challenge.
      effect: { type: "any" },
      maxAttempts: { type: "number" },
      rateLimitWindow: { type: "number" },
      enabled: { type: "boolean", default: true },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
      updatedAt: {
        type: "string",
        default: () => new Date().toISOString(),
        watch: "*",
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["challenge"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: ddbClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// Qrstat
// ---------------------------------------------------------------------------

/**
 * Qrstat entity — scan/handoff counters (spec §5.3). Keyed by `code` +
 * `bucket`, so one code fans out into many bucket rows (`total`, `day#<date>`,
 * `param#<value>`, `ctf#<challenge>` …). The rollup Lambda upserts these via
 * `.update({code,bucket}).add({count:delta}).set({lastSeen}).go()`; the
 * resolver never writes here.
 *
 * The rollup watermark lives on a reserved meta row: code="_meta",
 * bucket="watermark", lastSeen=<ISO of last processed log ts>.
 */
export const Qrstat = new Entity(
  {
    model: {
      entity: "Qrstat",
      version: "1",
      service: "run",
    },
    attributes: {
      code: { type: "string", required: true },
      bucket: { type: "string", required: true },
      count: { type: "number", default: 0 },
      lastSeen: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["code"] },
        sk: { field: "sk", composite: ["bucket"] },
      },
    },
  },
  { client: ddbClient, table: ELECTRO_TABLE }
);
