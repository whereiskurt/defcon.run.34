import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * Bib Entity
 *
 * Stores a single race-bib registration per participant, keyed by the OIDC
 * subject (`ownerSub`). One bib per account is enforced structurally via a
 * fixed SK literal ("BIB") so `create` collides on retry (idempotent).
 *
 * Fields (v1.5 Phase 21 design contract, updated by Phase 22-05 rescope
 * 2026-07-02):
 * - ownerSub: OIDC subject (from session.user.id). Primary partition key.
 * - nameOnBib: Editable text that renders on the bib preview (max 32 chars).
 *   Server enforces cap; UI enforces cap. Blocked from edits once nameLocked
 *   is set true by an admin.
 * - runnerCode: "BIB-XXXX" 4-char alphanumeric (no ambiguous chars). Immutable
 *   post-create (readOnly). Indexed via runnerCode-index GSI for Phase 22
 *   payment reconciliation lookups.
 * - paidAmount: cents integer, accumulative. Initialized to 0 at create; Phase
 *   22 SES-reconciled webhook Lambda increments as payments arrive.
 *   NOTE (Phase 22-05): payment is orthogonal to bib registration — a bib may
 *   be printed with paidAmount=0 (see `canPrintName()`).
 * - paidStatusHistory: append-only list of payment events. Phase 21 seeds
 *   empty; Phase 22 populates via {provider, amount, timestamp, reconciled_via}.
 * - willPayInPerson: (Phase 22-05, Kurt 2026-07-02) participant flag stating
 *   they intend to pay at defcon.run 34 in person rather than online. Persistent,
 *   PATCH-able. Does NOT affect the print gate — bib registration is free.
 *   Feeds the admin "pledged-unpaid" report (Task 22-05-07).
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
      // Phase 22-05: participant intends to pay at defcon.run 34 in person.
      // Orthogonal to `paidAmount` — a pledge to pay in-person is neither a
      // payment nor a print gate. Feeds the admin pledged-unpaid report
      // (Task 22-05-07). PATCH-able via /api/bib; default false so existing
      // rows read as "no in-person pledge" without a backfill.
      willPayInPerson: {
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
 * Options for {@link applyPayment}. Cents-first amounts throughout; the
 * caller is responsible for pinning currency to USD (only USD supported
 * at launch — see Phase 22 AI-SPEC.md §"System prompt").
 */
export interface ApplyPaymentInput {
  /** Payment source: "stripe" | "venmo" | "cashapp" (extensible). */
  provider: string;
  /** Amount to add to `paidAmount`, in whole cents. */
  amount_cents: number;
  /**
   * How this payment was reconciled — for Stripe webhook, use
   * `stripe_webhook_${session.id}` so the same session ID replaying
   * is detected as a dup and skipped. For the Haiku Lambda (Plan
   * 22-04) use `haiku_reconcile_${receiptId}`.
   */
  reconciled_via: string;
  /**
   * ISO8601 timestamp for the paidStatusHistory row. Defaults to
   * `new Date().toISOString()` — passed in for deterministic testing.
   */
  timestamp?: string;
}

/**
 * Idempotently apply a payment to a bib.
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-01-04):
 * - Atomically:
 *     1. add `amount_cents` to `paidAmount`
 *     2. append `{provider, amount, timestamp, reconciled_via}` to
 *        `paidStatusHistory`
 * - Idempotent by `reconciled_via`: if the current bib's history
 *   already contains a row with the same reconciled_via string, this
 *   is a no-op that returns the current bib unchanged. Stripe webhook
 *   retries fire the SAME session id via `stripe_webhook_${session.id}`,
 *   so the second delivery finds the marker and skips.
 * - Race window: two concurrent webhook deliveries could both read
 *   "no marker present" and both append. Stripe's retry policy is
 *   sequential-after-failure, not parallel, so this is theoretical
 *   but not practically observed. Post-launch a Set attribute for
 *   O(1) markers could tighten the race (v1.6 concern).
 * - Throws if the bib doesn't exist. Caller decides how to surface
 *   — webhook returns 404 so Stripe stops retrying.
 */
export async function applyPayment(
  ownerSub: string,
  input: ApplyPaymentInput
): Promise<BibItem> {
  const bib = await getBib(ownerSub);
  if (!bib) {
    throw new Error(`No bib found for ownerSub=${ownerSub}`);
  }

  // Idempotency check: if we've already applied this reconciliation
  // marker, short-circuit and return the current bib unchanged. This
  // covers Stripe webhook retries (same session.id) and Haiku
  // re-invocations (same receiptId) without double-crediting.
  const already = (bib.paidStatusHistory ?? []).some(
    (row) => row?.reconciled_via === input.reconciled_via
  );
  if (already) {
    return bib;
  }

  const timestamp = input.timestamp ?? new Date().toISOString();
  const amount = Math.max(0, Math.trunc(input.amount_cents));
  const historyRow = {
    provider: input.provider,
    amount,
    timestamp,
    reconciled_via: input.reconciled_via,
  };

  const result = await Bib.patch({ ownerSub })
    .add({ paidAmount: amount })
    .append({ paidStatusHistory: [historyRow] })
    .go({ response: "all_new" });
  return result.data as BibItem;
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

/**
 * Update the `willPayInPerson` pledge flag for the given owner (Phase 22-05).
 *
 * Design contract:
 * - Pure flip of a persistent boolean. Idempotent (setting `true` when it's
 *   already `true` is a no-op set from DDB's perspective).
 * - Does NOT interact with `nameLocked` — the pledge is orthogonal to the
 *   name-print gate. A locked-name bib may still toggle the pledge (e.g.,
 *   participant changes plans after registration lock).
 * - Throws when the bib doesn't exist so PATCH can surface a 404. The API
 *   layer matches "No bib found" as the marker (mirrors updateBibName).
 */
export async function updateBibWillPayInPerson(
  ownerSub: string,
  willPayInPerson: boolean
): Promise<BibItem> {
  const existing = await getBib(ownerSub);
  if (!existing) {
    throw new Error(`No bib found for ownerSub=${ownerSub}`);
  }

  const result = await Bib.patch({ ownerSub })
    .set({ willPayInPerson })
    .go({ response: "all_new" });
  return result.data as BibItem;
}

/**
 * Physical-bib print gate (SC8, v1.5 Phase 22, rescoped Phase 22-05).
 *
 * A bib may be sent to the printer iff:
 *   - `nameLocked === true` — an admin (Kurt/Jesse) has confirmed the
 *     name-on-bib is final and safe to render (prevents last-second
 *     profanity / typos in the physical print run).
 *
 * Phase 22-05 rescope (Kurt 2026-07-02): bib registration is FREE.
 * The former `paidAmount >= 1000` gate is INTENTIONALLY REMOVED — payment
 * is orthogonal to the print gate. Sponsors get a charm accent on the bib
 * preview (Phase 22-05-06), but everyone who registers by deadline gets
 * their name printed.
 *
 * The old `PRINT_PAID_MIN_CENTS` constant is intentionally removed.
 * Nothing else in the codebase referenced it after Plan 22-04; grep-guard
 * against reintroduction if the print pipeline ever needs a payment gate.
 *
 * Accepts either a BibItem or `null` for convenience at the API layer
 * (`canPrintName(await getBib(sub))` compiles).
 */
export function canPrintName(bib: BibItem | null | undefined): boolean {
  if (!bib) return false;
  return bib.nameLocked === true;
}
