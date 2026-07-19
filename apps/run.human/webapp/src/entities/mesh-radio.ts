import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * MeshRadio ElectroDB Entity (Phase 66, MRAD-01 / MRAD-08)
 *
 * The SINGLE SOURCE OF TRUTH for Meshtastic radios (LOCKED hard-switch decision,
 * CONTEXT §"§11 resolved"). This first-class entity replaces the embedded
 * `RunUser.meshtasticRadios[]` list and models the FULL radio state — not just
 * decrypt keys — so every reader/writer (register, user CRUD, map feed, backfill,
 * meshtk decrypt) targets one row per radio keyed by its canonical `nodeId`.
 *
 * ── Why this entity exists ─────────────────────────────────────────────────
 * meshtk (plan 66-07, Go) resolves a sender's authoritative X25519 pubkey with a
 * direct DynamoDB `GetItem` by `nodeId` (never a Scan). That hot path composes
 * the DynamoDB key BY HAND in Go, so the ElectroDB-composed key here is a
 * cross-language CONTRACT. See `mesh-radio-key-parity.test.ts`.
 *
 * ── Canonical key format (parity-locked against meshtk plan 66-07) ─────────
 *   primary pk = "$run#nodeid_" + <lowercased nodeId>   e.g. "$run#nodeid_!433d1cec"
 *   primary sk = "$meshradio_1"                          (== "$<entity>_<version>")
 *   byUser  gsi1pk = "$run#userid_" + <userId>           e.g. "$run#userid_user-abc"
 *   byUser  gsi1sk = "$run#nodeid_" + <lowercased nodeId>
 * ElectroDB v3.5 lowercases composite values (L12); `nodeId` hex is already
 * lowercase and the leading "!" is preserved literally. NEVER change
 * entity/version/service after the parity test locks — any drift silently 404s
 * every meshtk decrypt (L1).
 *
 * ── GSI / terraform (MRAD-08): NO terraform change ─────────────────────────
 * The shared `run-human-electro` table pre-provisions three generic GSIs
 * gsi1/gsi2/gsi3 (all projection ALL — see
 * infra/terraform/modules/dynamodb/v1.0.0/main.tf:24-53). `MeshRadio.byUser`
 * overlays the existing physical `gsi1pk-gsi1sk-index` as an ElectroDB
 * entity-scoped logical index. ElectroDB auto-scopes GSIs by entity, so sharing
 * gsi1 with RunUser/Accomplishment is collision-free. There is no terraform
 * change for this phase; the config half of MRAD-08 lives in plan 66-07.
 *
 * ── nodeId canonicalization (L2) ───────────────────────────────────────────
 * Write paths must canonicalize `nodeId` to "!" + nodeNum.toString(16).padStart(8,"0")
 * (lowercase) and store `nodeNum` (uint32) explicitly, so meshtk composes
 * fmt.Sprintf("!%08x", nodeNum) → a byte-identical pk without reversing hex.
 *
 * SERVER-ONLY data-layer module — never import into a client component. Every
 * write funnels through the helpers below so the write-invariant lives in one
 * place (L10).
 */
export const MeshRadio = new Entity(
  {
    model: {
      entity: "MeshRadio",
      version: "1",
      service: "run",
    },
    attributes: {
      // Canonical "!hex" id — the natural key. Stored lowercase, pad-8 (L2).
      nodeId: {
        type: "string",
        required: true,
      },
      // uint32 node number. Stored explicitly so meshtk composes the pk from the
      // integer (fmt.Sprintf("!%08x", nodeNum)) instead of reversing the hex id.
      nodeNum: {
        type: "number",
        required: true,
      },
      // Owning RunUser adapter userId (= session.user.id). byUser GSI partition.
      userId: {
        type: "string",
        required: true,
      },
      // Authoritative X25519 public key as "0x" + 64 hex chars (converted from the
      // device's base64 once at the register-radio write boundary — plan 66-02).
      publicKey: {
        type: "string",
      },
      privateKey: {
        type: "string",
      },
      verified: {
        type: "boolean",
        default: false,
      },
      verificationCode: {
        type: "string",
      },
      verifiedAt: {
        type: "number",
      },
      verificationAttempts: {
        type: "number",
        default: 0,
      },
      resendAttempts: {
        type: "number",
        default: 0,
      },
      impersonate: {
        type: "boolean",
        default: false,
      },
      showOnMap: {
        type: "boolean",
        default: false,
      },
      // How this radio row was created: run.flash register ("flash"), the flash
      // "Sync keys" read-back ("sync"), or the user-facing manual add ("manual").
      source: {
        type: ["flash", "sync", "manual"] as const,
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
          composite: ["nodeId"],
        },
        sk: {
          field: "sk",
          composite: [],
        },
      },
      // Per-user listing / admin / the deferred Layer-2 join. Overlays the
      // pre-provisioned generic gsi1 (see header — no terraform change, MRAD-08).
      byUser: {
        index: "gsi1pk-gsi1sk-index",
        pk: {
          field: "gsi1pk",
          composite: ["userId"],
        },
        sk: {
          field: "gsi1sk",
          composite: ["nodeId"],
        },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

/**
 * Inferred MeshRadio item type from the ElectroDB entity.
 */
export type MeshRadioItem = EntityItem<typeof MeshRadio>;

/**
 * How a MeshRadio row was created. `flash` = run.flash register; `sync` = the
 * flash "Sync keys" key read-back; `manual` = user-facing add.
 */
export type MeshRadioSource = "flash" | "sync" | "manual";

/**
 * Input to upsertMeshRadio. `nodeId` MUST already be canonicalized (lowercase,
 * "!" + pad-8 hex) by the caller's write boundary (L2); this store does not
 * re-derive it. `publicKey`, when present, is the "0x" hex form (plan 66-02).
 */
export interface UpsertMeshRadioInput {
  nodeId: string;
  nodeNum: number;
  userId: string;
  publicKey?: string;
  privateKey?: string;
  verified?: boolean;
  verificationCode?: string;
  verifiedAt?: number;
  verificationAttempts?: number;
  resendAttempts?: number;
  impersonate?: boolean;
  showOnMap?: boolean;
  source?: MeshRadioSource;
}

/**
 * Upsert a radio row by its canonical nodeId (SERVER-ONLY, sole write funnel — L10).
 *
 * `MeshRadio.put` upserts: a row for this nodeId is created or fully replaced.
 * Every key-affecting write site (register, user add/PATCH, backfill, sync) calls
 * THIS helper so the pk/sk composition — the meshtk contract — lives in exactly
 * one place and can never drift per call site.
 */
export async function upsertMeshRadio(input: UpsertMeshRadioInput) {
  const result = await MeshRadio.put(input).go();
  return result.data;
}

/**
 * Delete a radio row by its canonical nodeId (SERVER-ONLY — L10).
 * Idempotent at the DynamoDB level: deleting a missing key is a no-op.
 */
export async function deleteMeshRadio(nodeId: string) {
  await MeshRadio.delete({ nodeId }).go();
}

/**
 * Fetch a single radio row by its canonical nodeId (SERVER-ONLY).
 * Returns the item or undefined. This is the run.human twin of the meshtk
 * GetItem hot path — same key, same row.
 */
export async function getMeshRadio(nodeId: string) {
  const result = await MeshRadio.get({ nodeId }).go();
  return result.data ?? undefined;
}

/**
 * All radios for a user via the byUser GSI, all pages (SERVER-ONLY).
 * Backs per-user listing, admin, quota-by-count, and the deferred Layer-2 join.
 */
export async function getMeshRadiosByUser(userId: string) {
  const result = await MeshRadio.query.byUser({ userId }).go({ pages: "all" });
  return result.data;
}

/**
 * The ONE programmatic source of MeshRadio's canonical primary key (PURE, offline).
 *
 * Returns the parity-locked { pk, sk } for a given `nodeId` by asking ElectroDB to
 * compose the key (no network I/O). meshtk (plan 66-07) reproduces these exact
 * strings in Go by hand — this helper exists so nothing on the TS side ever
 * hand-guesses the format, and so callers/tests always read the key from the same
 * source of truth as the entity itself.
 *
 *   pk = "$run#nodeid_" + <lowercased nodeId>   e.g. "$run#nodeid_!433d1cec"
 *   sk = "$meshradio_1"
 *
 * The byUser GSI partition (not returned here) is "$run#userid_" + userId.
 */
export function meshRadioKeyFor(nodeId: string): { pk: string; sk: string } {
  const key = MeshRadio.get({ nodeId }).params().Key as {
    pk: string;
    sk: string;
  };
  return { pk: key.pk, sk: key.sk };
}
