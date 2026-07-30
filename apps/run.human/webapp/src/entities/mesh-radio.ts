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
      // ── Ownership-transfer audit trail (see transferMeshRadioOwner) ─────────
      // Set when a re-flash moved this radio to a different account. Meshtastic
      // derives myNodeNum from the ESP32 MAC, so re-flashing NEVER changes the
      // "!id" — the same physical radio handed to a new runner (event loaners)
      // arrives at an existing row owned by someone else. Absent on rows that
      // have never changed hands.
      previousUserId: {
        type: "string",
      },
      transferredAt: {
        type: "number",
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
      // Epoch ms when meshtk last PKI-DM'd the current verification code to the
      // device (written by the Go poller via a guarded UpdateItem). Cleared by
      // the resend route so the UI flips back to "waiting" until the new code
      // lands. Absent = not yet delivered.
      codeSentAt: {
        type: "number",
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
 * Fields patchMeshRadio may mutate in place. Excludes the identity keys
 * (nodeId/nodeNum/userId) and the create-only `source`/`createdAt` — those are
 * set once at upsert time. Used by the user-facing PATCH (verify/keys/
 * impersonate/showOnMap) and resend flows (plan 66-03).
 *
 * `userId` is excluded as POLICY, not capability: ownership must never move as a
 * side effect of a routine field update. ElectroDB is perfectly willing to move it
 * (and the GSI with it) — moving an owner is therefore a deliberate, audited call to
 * `transferMeshRadioOwner` below, and nothing else.
 */
export interface PatchMeshRadioInput {
  publicKey?: string;
  privateKey?: string;
  verified?: boolean;
  verificationCode?: string;
  verifiedAt?: number;
  verificationAttempts?: number;
  resendAttempts?: number;
  impersonate?: boolean;
  showOnMap?: boolean;
}

/**
 * Partially update an existing radio row by its canonical nodeId (SERVER-ONLY).
 *
 * Uses ElectroDB `patch` (a true partial update) rather than `upsertMeshRadio`'s
 * `put`, so `createdAt` / `nodeNum` / `source` and any un-touched field are
 * preserved — a full-item `put` would reset the readOnly `createdAt` default.
 * Re-reads and returns the full row so callers can surface it to the client.
 * The pk/sk composition still funnels through the same entity, so the meshtk
 * contract is unaffected.
 */
export async function patchMeshRadio(nodeId: string, fields: PatchMeshRadioInput) {
  await MeshRadio.patch({ nodeId }).set(fields).go();
  return getMeshRadio(nodeId);
}

/**
 * Key material the transferring flash read off the device, if any.
 * `publicKey` is the "0x" hex form (converted at the write boundary, plan 66-02).
 */
export interface TransferMeshRadioKeys {
  publicKey?: string;
  privateKey?: string;
}

/**
 * Move an existing radio row to a NEW owner (SERVER-ONLY, sole transfer funnel — L10).
 *
 * ── Why this helper exists ─────────────────────────────────────────────────
 * Meshtastic derives `myNodeNum` from the ESP32 MAC, so re-flashing a radio never
 * changes its "!id". When a physical radio changes hands (event loaners are
 * routinely reassigned) the new owner's flash lands on a row owned by the PREVIOUS
 * user. The register write boundary used to blind-`patchMeshRadio` that row, which
 * overwrote the previous owner's keys and flipped `verified` while leaving `userId`
 * untouched — an authorization hole that also mis-attributed the new radio's mesh
 * traffic to the old account. Transfer is now EXPLICIT and audited, never implied.
 *
 * A transfer is allowed on purpose: flashing proves physical USB possession and the
 * client reads the device's own private key straight off the hardware — strictly
 * stronger proof than the OTP path behind the manual add. The CALLER is responsible
 * for consuming the new owner's radio quota before calling this.
 *
 * ── Why `patch` and not `put` ──────────────────────────────────────────────
 * `userId` is the `byUser` GSI partition composite (gsi1pk), so it is tempting to
 * assume only a full-item `put` can move it. It can NOT be assumed — and `put` is
 * the wrong tool here: a full-item replace silently drops every field the caller
 * forgets to carry forward (createdAt / showOnMap / impersonate / source / nodeNum /
 * the verification counters), and would re-break as soon as this entity grows an
 * attribute. ElectroDB v3.7 `patch().set({ userId })` DOES recompute the GSI keys —
 * it emits a single atomic UpdateItem containing
 *
 *   SET #userId = :userId_u0, ..., #gsi1pk = :gsi1pk_u0   with  :gsi1pk_u0 = "$run#userid_<new>"
 *
 * so the byUser index moves to the new owner and goes stale for the old one in one
 * write, while every untouched attribute is preserved by construction. Locked by
 * test ("moves the byUser GSI partition to the new owner") — that GSI is what "my
 * radios" actually queries, so a userId-only write would leave the index lying.
 * `patch` also carries `attribute_exists(pk)`, so a transfer can never create a row.
 *
 * The previous owner's verification secrets are dropped rather than inherited: the
 * row comes out `verified: true`, and a stale code belonging to another account has
 * no business sitting on this one.
 *
 * Returns the re-read row. NEVER logs key material.
 */
export async function transferMeshRadioOwner(
  existing: MeshRadioItem,
  newUserId: string,
  keys: TransferMeshRadioKeys = {}
) {
  const now = Date.now();
  await MeshRadio.patch({ nodeId: existing.nodeId })
    .set({
      userId: newUserId,
      previousUserId: existing.userId,
      transferredAt: now,
      ...(keys.publicKey ? { publicKey: keys.publicKey } : {}),
      ...(keys.privateKey !== undefined ? { privateKey: keys.privateKey } : {}),
      // Physical possession re-proves the radio; `verifiedAt` must stop pointing at
      // the PREVIOUS owner's verification event.
      verified: true,
      verifiedAt: now,
    })
    .remove(["verificationCode", "codeSentAt"])
    .go();
  return getMeshRadio(existing.nodeId);
}

/**
 * Resend rotates the code; drop the stale delivery stamp so the UI shows
 * "waiting" until meshtk re-sends the new code (SERVER-ONLY).
 */
export async function clearCodeSentAt(nodeId: string) {
  await MeshRadio.patch({ nodeId }).remove(["codeSentAt"]).go();
}

/**
 * Delete a radio row by its canonical nodeId (SERVER-ONLY — L10).
 * Idempotent at the DynamoDB level: deleting a missing key is a no-op.
 */
export async function deleteMeshRadio(nodeId: string) {
  await MeshRadio.delete({ nodeId }).go();
}

/**
 * Scan every MeshRadio row (SERVER-ONLY, low-frequency).
 *
 * Backs the internal mesh-map feed, which enumerates verified+showOnMap radios
 * across all users. ElectroDB auto-scopes the scan to the MeshRadio entity. The
 * meshtk no-Scan constraint applies ONLY to meshtk's decrypt hot path (a direct
 * GetItem by nodeId), NOT this low-frequency app feed (CONTEXT / plan 66-03).
 */
export async function scanAllMeshRadios() {
  const result = await MeshRadio.scan.go({ pages: "all" });
  return result.data;
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
