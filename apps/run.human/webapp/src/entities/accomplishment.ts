import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";
import { updateRunUserActivityCounts } from "./run-user";

/**
 * Accomplishment ElectroDB Entity (Phase 49, LDBR-01)
 *
 * The leaderboard's source of truth for the runs THIS board scores: check-ins +
 * GPX (Strava reserved). A DC33 port of `db/accomplishment.ts` adapted to the
 * DC34 shared `run-human-electro` table and identity model:
 *   - service "run" (matches RunUser/CheckIn, shared table)
 *   - keyed by `userId` (the Auth.js adapter uuid = session.user.id =
 *     RunUser.userId) — DC34 drops DC33's `userEmail` arg entirely
 *   - `source` enum is `["checkin","gpx","strava"]` ONLY. This enum is the
 *     LDBR-12 write-side CTF boundary: `ctf`/`qr` are NOT permitted values, so
 *     a CTF solve can never become an Accomplishment (CTF scoring is owned by
 *     the separate CTF judge worktree, which only writes RunUser.ctfScore).
 *   - `type` is a one-value enum `["activity"]` for v1 (no social/meshctf).
 *
 * GSIs mirror DC33 so Phase 51/52 queries port cleanly:
 *   - byType (gsi1pk-gsi1sk-index): pk=[userId,type], sk=completedAt
 *   - byYear (gsi2pk-gsi2sk-index): pk=[userId,year], sk=completedAt
 * ElectroDB auto-scopes GSIs by entity, so sharing the physical gsi1/gsi2
 * indexes with RunUser/CheckIn is safe (distinct entities, isolated key space).
 *
 * SERVER-ONLY data-layer module — never import into a client component.
 */
export const Accomplishment = new Entity(
  {
    model: {
      entity: "Accomplishment",
      version: "1",
      service: "run",
    },
    attributes: {
      userId: {
        type: "string",
        required: true,
      },
      accomplishmentId: {
        type: "string",
        required: true,
      },
      // v1 only writes activity accomplishments. Kept a one-value enum so the
      // byType GSI has a stable partition and social/meshctf can be added later.
      type: {
        type: ["activity"] as const,
        required: true,
        default: "activity",
      },
      // LDBR-12 boundary: the ONLY origin values a run may have. ctf/qr are
      // deliberately absent — CTF never becomes an accomplishment.
      source: {
        type: ["checkin", "gpx", "strava"] as const,
        required: true,
      },
      name: {
        type: "string",
        required: true,
      },
      description: {
        type: "string",
      },
      completedAt: {
        type: "number",
        required: true,
      },
      year: {
        type: "number",
        required: true,
      },
      // Carried from the source check-in and persisted now (even though the
      // board is admin-only) so the launch-time privacy filter has its data
      // without a backfill (spec §9). Not used for filtering yet.
      isPrivate: {
        type: "boolean",
        default: false,
      },
      metadata: {
        type: "map",
        properties: {
          // Point value of this run — the amount createAccomplishment adds to
          // RunUser.activityScore (and deleteAccomplishment reverses).
          points: { type: "number" },
          // Route geometry for the future PolylineRenderer (Phase 52). A list
          // of {lat,lng} samples — mirrors the DC33 polyline concept as
          // structured points rather than an encoded string.
          polyline: {
            type: "list",
            items: {
              type: "map",
              properties: {
                lat: { type: "number" },
                lng: { type: "number" },
              },
            },
          },
          distance: { type: "number" },
          elevation: { type: "number" },
          // External-id backpointers — the dup-guard keys on the field that
          // matches `source` (checkInId | gpxFileId | stravaActivityId).
          gpxFileId: { type: "string" },
          checkInId: { type: "string" },
          stravaActivityId: { type: "string" },
        },
      },
      createdAt: {
        type: "number",
        default: () => Date.now(),
        readOnly: true,
      },
      updatedAt: {
        type: "number",
        watch: "*",
        set: () => Date.now(),
        readOnly: true,
      },
    },
    indexes: {
      primary: {
        pk: {
          field: "pk",
          composite: ["userId"],
        },
        sk: {
          field: "sk",
          composite: ["accomplishmentId"],
        },
      },
      byType: {
        index: "gsi1pk-gsi1sk-index",
        pk: {
          field: "gsi1pk",
          composite: ["userId", "type"],
        },
        sk: {
          field: "gsi1sk",
          composite: ["completedAt"],
        },
      },
      byYear: {
        index: "gsi2pk-gsi2sk-index",
        pk: {
          field: "gsi2pk",
          composite: ["userId", "year"],
        },
        sk: {
          field: "gsi2sk",
          composite: ["completedAt"],
        },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Inferred Accomplishment item type from the ElectroDB entity.
 */
export type AccomplishmentItem = EntityItem<typeof Accomplishment>;

/**
 * The origin of a scored run. LDBR-12: ctf/qr are intentionally NOT members —
 * this union is the type-level half of the CTF write boundary.
 */
export type AccomplishmentSource = "checkin" | "gpx" | "strava";

/**
 * The metadata field that carries a source's external id — the key the dup-guard
 * matches on. Keeping this map centralizes the source→field mapping so the id
 * minter and the dup-guard can never disagree about which field is authoritative.
 */
const EXTERNAL_ID_FIELD: Record<
  AccomplishmentSource,
  "checkInId" | "gpxFileId" | "stravaActivityId"
> = {
  checkin: "checkInId",
  gpx: "gpxFileId",
  strava: "stravaActivityId",
};

/**
 * Deterministic, collision-stable accomplishment id (PURE).
 *
 * `"${source}#${externalId}"` makes idempotency a cheap sort-key collision: a
 * replayed create for the same (source, externalId) mints the SAME id, so it
 * lands on the same primary sk and the write path can short-circuit before
 * touching the RunUser rollup (no double-score — see T-49-05). The id is
 * namespaced by source so the same external id under two sources never clashes.
 */
export function accomplishmentIdFor(
  source: AccomplishmentSource,
  externalId: string
): string {
  return `${source}#${externalId}`;
}

/**
 * Read-side idempotency backstop (PURE).
 *
 * Returns the existing accomplishment that already represents (source,
 * externalId), or undefined if none does. Matches on the source's OWN external-id
 * metadata field (checkInId | gpxFileId | stravaActivityId), never a foreign
 * one — so a check-in row carrying an id that happens to equal a gpx query arg is
 * NOT a duplicate. Used by createAccomplishment to avoid a second row + a second
 * rollup bump on replay.
 */
export function findDuplicate(
  existing: AccomplishmentItem[],
  source: AccomplishmentSource,
  externalId: string
): AccomplishmentItem | undefined {
  const field = EXTERNAL_ID_FIELD[source];
  return existing.find(
    (a) => a.source === source && a.metadata?.[field] === externalId
  );
}

/**
 * Input to createAccomplishment. `points` is supplied by the caller (the
 * check-in hook / GPX endpoint pass POINTS.<source> from leaderboard-scoring.ts)
 * so the point value has a single source of truth outside this data module.
 * Exactly one of checkInId / gpxFileId / stravaActivityId must be present — the
 * one that matches `source`.
 */
export interface CreateAccomplishmentInput {
  userId: string;
  source: AccomplishmentSource;
  type?: "activity";
  name: string;
  description?: string;
  completedAt: number;
  year?: number;
  isPrivate?: boolean;
  points: number;
  checkInId?: string;
  gpxFileId?: string;
  stravaActivityId?: string;
  polyline?: { lat: number; lng: number }[];
  distance?: number;
  elevation?: number;
}

/**
 * Resolve the external id that matches `source` (the id the dup-guard/minter key
 * on). Returns undefined when the caller forgot the source's own id field.
 */
function externalIdFor(
  source: AccomplishmentSource,
  input: Pick<
    CreateAccomplishmentInput,
    "checkInId" | "gpxFileId" | "stravaActivityId"
  >
): string | undefined {
  if (source === "checkin") return input.checkInId;
  if (source === "gpx") return input.gpxFileId;
  return input.stravaActivityId;
}

/**
 * Create an accomplishment row AND atomically bump the RunUser rollup (LDBR-01).
 *
 * IDEMPOTENT (T-49-05): the id is deterministic (`accomplishmentIdFor`), so a
 * replayed create lands on the same primary sk. We `get` that id first; if the
 * row already exists we return it WITHOUT a second write or a second rollup
 * bump — no double-scoring. Only a genuinely new row bumps
 * `RunUser.activityScore` / `activityCounts.<source>` via
 * updateRunUserActivityCounts (the sole rollup writer, increment:true).
 *
 * NOTE: the rollup mutator owns `checkin`/`gpx` only. `strava` is reserved in
 * this milestone (no Strava write path is wired yet) and has no activityCounts
 * slot, so a strava accomplishment persists its row but does not yet contribute
 * to activityScore. This keeps the create-bumps-once invariant type-safe; wiring
 * Strava into the rollup is a later-phase concern.
 *
 * SERVER-ONLY — do not import into a client component.
 */
export async function createAccomplishment(input: CreateAccomplishmentInput) {
  const {
    userId,
    source,
    type = "activity",
    name,
    description,
    completedAt,
    isPrivate,
    points,
    checkInId,
    gpxFileId,
    stravaActivityId,
    polyline,
    distance,
    elevation,
  } = input;

  const year = input.year ?? new Date(completedAt).getUTCFullYear();

  const externalId = externalIdFor(source, input);
  if (!externalId) {
    throw new Error(
      `createAccomplishment: missing external id for source "${source}" ` +
        `(expected ${EXTERNAL_ID_FIELD[source]})`
    );
  }

  const accomplishmentId = accomplishmentIdFor(source, externalId);

  // Idempotency short-circuit: deterministic sk collision means a replay is a
  // no-op. Return the existing row without writing or bumping the rollup.
  const existing = await Accomplishment.get({ userId, accomplishmentId }).go();
  if (existing.data) {
    return existing.data;
  }

  const metadata = {
    points,
    ...(polyline !== undefined ? { polyline } : {}),
    ...(distance !== undefined ? { distance } : {}),
    ...(elevation !== undefined ? { elevation } : {}),
    ...(checkInId !== undefined ? { checkInId } : {}),
    ...(gpxFileId !== undefined ? { gpxFileId } : {}),
    ...(stravaActivityId !== undefined ? { stravaActivityId } : {}),
  };

  const result = await Accomplishment.create({
    userId,
    accomplishmentId,
    type,
    source,
    name,
    description,
    completedAt,
    year,
    isPrivate: isPrivate ?? false,
    metadata,
  }).go();

  // Bump the rollup exactly once, only for a genuinely new row. All three
  // sources (checkin/gpx/strava) join the rollup — the enum already restricts
  // `source` to those, so no guard is needed here.
  await updateRunUserActivityCounts(userId, {
    source,
    pointsDelta: points,
    completedAt,
    increment: true,
  });

  return result.data;
}

/**
 * All accomplishments for a user (primary index, all pages). Server-only.
 */
export async function getAccomplishmentsByUser(userId: string) {
  const result = await Accomplishment.query
    .primary({ userId })
    .go({ pages: "all" });
  return result.data;
}

/**
 * Delete an accomplishment row and reverse its rollup contribution (LDBR-01).
 *
 * IDEMPOTENT (T-49-07): gets the row first; if it is already gone this is a
 * no-op with NO decrement — so deleting a missing/foreign row can never drift
 * the rollup negative. Otherwise it deletes the row and decrements the rollup
 * exactly once (updateRunUserActivityCounts, increment:false — floored at 0 by
 * the mutator). All three sources (checkin/gpx/strava) are wired on the rollup
 * side, same as create — the enum already restricts `row.source` to those.
 *
 * SERVER-ONLY — do not import into a client component.
 */
export async function deleteAccomplishment(
  userId: string,
  accomplishmentId: string
) {
  const existing = await Accomplishment.get({ userId, accomplishmentId }).go();
  if (!existing.data) {
    return; // idempotent no-op - nothing to delete, nothing to decrement
  }
  const row = existing.data;

  await Accomplishment.delete({ userId, accomplishmentId }).go();

  await updateRunUserActivityCounts(userId, {
    source: row.source,
    pointsDelta: row.metadata?.points ?? 0,
    completedAt: row.completedAt,
    increment: false,
  });
}
