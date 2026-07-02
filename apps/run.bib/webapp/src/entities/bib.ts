import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * Bib Entity
 *
 * Stores a single race-bib registration per participant, keyed by the OIDC
 * subject (`ownerSub`). One bib per account is enforced structurally via a
 * fixed SK literal ("BIB") so `create` collides on retry (idempotent).
 *
 * Fields (v1.5 Phase 21 design contract — Kurt 2026-07-02):
 * - ownerSub: OIDC subject (from session.user.id). Primary partition key.
 * - nameOnBib: Editable text that renders on the bib preview (max 32 chars).
 *   Server enforces cap; UI enforces cap. Blocked from edits once nameLocked
 *   is set true by an admin.
 * - runnerCode: "BIB-XXXX" 4-char alphanumeric (no ambiguous chars). Immutable
 *   post-create (readOnly). Indexed via runnerCode-index GSI for Phase 22
 *   payment reconciliation lookups.
 * - paidAmount: cents integer, accumulative. Initialized to 0 at create; Phase
 *   22 SES-reconciled webhook Lambda increments as payments arrive.
 * - paidStatusHistory: append-only list of payment events. Phase 21 seeds
 *   empty; Phase 22 populates via {provider, amount, timestamp, reconciled_via}.
 * - nameLocked: admin-set boolean; PATCH must 409 when true.
 * - createdAt / updatedAt: ISO8601 timestamps.
 *
 * NB: no size / no shirt-size fields — Kurt design contract 2026-07-02.
 */
export const Bib = new Entity(
  {
    model: {
      entity: "Bib",
      version: "1",
      service: "run",
    },
    attributes: {
      ownerSub: {
        type: "string",
        required: true,
      },
      nameOnBib: {
        type: "string",
        default: "",
      },
      runnerCode: {
        type: "string",
        required: true,
        readOnly: true,
      },
      paidAmount: {
        type: "number",
        default: 0,
      },
      paidStatusHistory: {
        type: "list",
        items: {
          type: "map",
          properties: {
            provider: { type: "string" },
            amount: { type: "number" },
            timestamp: { type: "string" }, // ISO8601
            reconciled_via: { type: "string" },
          },
        },
        default: () => [],
      },
      nameLocked: {
        type: "boolean",
        default: false,
      },
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
      // Primary: single-record-per-user via fixed SK literal "BIB"
      primary: {
        pk: { field: "pk", composite: ["ownerSub"] },
        sk: {
          field: "sk",
          composite: [],
          template: "BIB",
        },
      },
      // GSI for Phase 22 reconciliation Lambda: look up bib by runnerCode.
      // Uses the runnerCode-index GSI added to run-human-electro in Phase 20
      // (infra/terraform/live/site/services/run.human/service.hcl:286-292).
      //
      // The GSI is HASH-only on DynamoDB (no range_key on the terraform
      // resource). We still declare a synthetic `runnerCodeSk` field for
      // ElectroDB — reusing the primary "sk" field triggers ElectroDB
      // error 1017 (IncompatibleKeyCompositeAttributeTemplate) because the
      // primary's sk uses the fixed template "BIB" and the byRunnerCode sk
      // has no template. The synthetic field is written to the item but is
      // NOT projected onto the GSI (DynamoDB only indexes attributes that
      // match the declared key schema), so it costs a few bytes per row and
      // otherwise no-ops.
      byRunnerCode: {
        index: "runnerCode-index",
        pk: { field: "runnerCode", composite: ["runnerCode"] },
        sk: { field: "runnerCodeSk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export type BibItem = EntityItem<typeof Bib>;

/**
 * Thrown by updateBibName when the bib has nameLocked=true. The API layer maps
 * this to a 409 Conflict response with {error: "name_locked"}.
 */
export class NameLockedError extends Error {
  constructor(ownerSub: string) {
    super(`Bib name is locked for ownerSub=${ownerSub}`);
    this.name = "NameLockedError";
  }
}

/**
 * Fetch the bib for a given owner. Returns null if the user has not created
 * one yet.
 */
export async function getBib(ownerSub: string): Promise<BibItem | null> {
  const result = await Bib.get({ ownerSub }).go();
  return result.data ?? null;
}

/**
 * Look up a bib by its runnerCode (Phase 22 reconciliation).
 * Returns null if no bib holds that code.
 */
export async function getBibByRunnerCode(
  runnerCode: string
): Promise<BibItem | null> {
  const result = await Bib.query.byRunnerCode({ runnerCode }).go();
  return result.data[0] ?? null;
}

/**
 * Idempotently create a bib for the owner.
 *
 * Attempts to insert the bib; if a bib already exists for this ownerSub (the
 * fixed-SK primary key collides), returns the existing record instead of
 * throwing. Callers can treat this as "create or read" and always get a valid
 * bib back.
 *
 * The runnerCode passed in should be the result of generateUniqueRunnerCode()
 * (see src/lib/runner-code.ts). On collision the newly-generated code is
 * discarded because the existing record's runnerCode is what wins.
 */
export async function createBib(
  ownerSub: string,
  runnerCode: string
): Promise<BibItem> {
  try {
    const result = await Bib.create({
      ownerSub,
      runnerCode,
    }).go();
    return result.data;
  } catch (err) {
    // ElectroDB wraps ConditionalCheckFailedException on create with an
    // .code === "ConditionalCheckFailed" or .name matching that shape. Handle
    // both the SDK-level exception name and the string in the message so we
    // survive SDK v2/v3 message differences.
    const isConditionalFail =
      (err instanceof Error &&
        (err.name === "ConditionalCheckFailedException" ||
          err.message.includes("ConditionalCheckFailed"))) ||
      (typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "ConditionalCheckFailedException");

    if (!isConditionalFail) {
      throw err;
    }

    // Collision means the bib already exists for this owner — return it.
    const existing = await getBib(ownerSub);
    if (!existing) {
      // Extremely unlikely: create said the row exists, but a re-read finds
      // nothing. Surface as an error rather than silently masking data loss.
      throw new Error(
        `createBib collision for ownerSub=${ownerSub} but re-read returned null`
      );
    }
    return existing;
  }
}

/**
 * Update the nameOnBib for the given owner.
 * Throws NameLockedError when the bib's nameLocked flag is true — API layer
 * translates this to a 409.
 */
export async function updateBibName(
  ownerSub: string,
  nameOnBib: string
): Promise<BibItem> {
  const existing = await getBib(ownerSub);
  if (!existing) {
    throw new Error(`No bib found for ownerSub=${ownerSub}`);
  }
  if (existing.nameLocked) {
    throw new NameLockedError(ownerSub);
  }

  // Server-side cap at 32 chars, matching the design-contract render budget.
  const trimmed = nameOnBib.trim().slice(0, 32);

  const result = await Bib.patch({ ownerSub })
    .set({ nameOnBib: trimmed })
    .go({ response: "all_new" });
  return result.data as BibItem;
}
