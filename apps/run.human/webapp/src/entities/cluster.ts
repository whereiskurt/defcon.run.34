import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * Cluster check-in bonus entities (run.human-only).
 *
 * These live on the SHARED `run-human-electro` table (`service: "run"`,
 * `version: "1"`) alongside RunUser / CheckIn / the Ctf family. Like the CTF
 * judge entities there is NO q.defcon.run resolver `.mjs` mirror — the resolver
 * never reads these rows; the key shapes are run.human-internal.
 *
 *   ClusterAward     — the LEDGER. One row per (runner, cluster they were in).
 *   ClusterConfig    — singleton tunables row (radius / window / tiers / cap).
 *   ClusterDemoUser  — manifest of seeded demo runners, so "clear demo data"
 *                      deletes an EXPLICIT list rather than prefix-matching.
 *
 * Schema only: the sweep (`lib/cluster-sweep.ts`) owns the reconcile logic.
 */

// ---------------------------------------------------------------------------
// ClusterAward — the ledger the scoring engine re-values
// ---------------------------------------------------------------------------
//
// The sort key is the runner's ANCHOR check-in: their earliest check-in in the
// cluster. That is what makes a re-sweep idempotent. When a cluster grows from
// 6 runners to 14, every original member still anchors on the same check-in, so
// their award row is UPDATED with the larger tier rather than duplicated. A
// cluster that dissolves under a config retune has its rows deleted by the
// sweep's diff, never stranded.
//
// byRecent (gsi2, partition TYPE#CLUSTERAWARD) lets the sweep reconcile a
// bounded time range with a key condition instead of a table scan. It shares
// gsi2pk-gsi2sk-index with CheckIn.byGlobalRecent (partition TYPE#CHECKIN) —
// different partition value, so there is no collision.
export const ClusterAward = new Entity(
  {
    model: { entity: "ClusterAward", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      /** The runner's earliest check-in in the cluster — the idempotency key. */
      anchorCheckInId: { type: "string", required: true },
      /** Detector-assigned id; changes as membership changes (audit only). */
      clusterId: { type: "string" },
      /** Con-local YYYY-MM-DD of the cluster start — the per-day cap groups on this. */
      day: { type: "string" },
      /** Distinct runners in the cluster when it was awarded. */
      size: { type: "number" },
      /** Points THIS runner earned. Capped later, in the engine, not here. */
      points: { type: "number" },
      centroidLat: { type: "number" },
      centroidLng: { type: "number" },
      /** Cluster start, epoch ms — the engine groups by this, not by sweep time. */
      startAt: { type: "number", required: true },
      endAt: { type: "number" },
      /** When the sweep last wrote this row, epoch ms. */
      awardedAt: { type: "number", default: () => Date.now() },
      createdAt: { type: "number", default: () => Date.now(), readOnly: true },
      updatedAt: { type: "number", watch: "*", set: () => Date.now(), readOnly: true },
    },
    indexes: {
      // "all my cluster awards" — the rescore read path.
      primary: {
        pk: { field: "pk", composite: ["userId"] },
        sk: { field: "sk", composite: ["anchorCheckInId"] },
      },
      // Time-ranged reconcile + admin listing.
      byRecent: {
        index: "gsi2pk-gsi2sk-index",
        pk: { field: "gsi2pk", composite: [], template: "TYPE#CLUSTERAWARD" },
        sk: { field: "gsi2sk", composite: ["startAt"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export type ClusterAwardItem = EntityItem<typeof ClusterAward>;

// ---------------------------------------------------------------------------
// ClusterConfig — singleton tunables
// ---------------------------------------------------------------------------
//
// Persisted (rather than hardcoded) so the radius can be retuned from a phone
// at the con without cutting a release. Exactly one row exists; readers fall
// back to DEFAULT_CLUSTER_CONFIG when it is absent.
export const ClusterConfig = new Entity(
  {
    model: { entity: "ClusterConfig", version: "1", service: "run" },
    attributes: {
      enabled: { type: "boolean" },
      radiusMeters: { type: "number" },
      windowMinutes: { type: "number" },
      minRunners: { type: "number" },
      maxPerUserPerDay: { type: "number" },
      tiers: {
        type: "list",
        items: {
          type: "map",
          properties: {
            minRunners: { type: "number" },
            points: { type: "number" },
          },
        },
      },
      /** authUserId of the admin who last saved — audit trail. */
      updatedBy: { type: "string" },
      updatedAt: { type: "number", watch: "*", set: () => Date.now() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "TYPE#CLUSTERCONFIG" },
        sk: { field: "sk", composite: [], template: "CONFIG" },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

// ---------------------------------------------------------------------------
// ClusterDemoUser — explicit manifest of seeded demo runners
// ---------------------------------------------------------------------------
//
// "Clear demo data" walks THIS manifest and deletes exactly the runners listed,
// rather than matching a userId prefix. Prefix matching has burned this repo
// before (a legitimate row whose key merely starts with the same characters),
// so the seeder records what it created and the cleaner only removes that.
export const ClusterDemoUser = new Entity(
  {
    model: { entity: "ClusterDemoUser", version: "1", service: "run" },
    attributes: {
      userId: { type: "string", required: true },
      /** Which seeded scenario this runner belongs to — shown in the admin UI. */
      scenario: { type: "string" },
      displayName: { type: "string" },
      createdAt: { type: "number", default: () => Date.now(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "TYPE#CLUSTERDEMO" },
        sk: { field: "sk", composite: ["userId"] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export type ClusterDemoUserItem = EntityItem<typeof ClusterDemoUser>;
