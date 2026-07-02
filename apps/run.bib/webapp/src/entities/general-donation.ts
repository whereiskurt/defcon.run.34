import { Entity, type EntityItem } from "electrodb";
import { electroClient, ELECTRO_TABLE } from "./client";

/**
 * GeneralDonation Entity (Phase 22-05, Kurt 2026-07-02 rescope).
 *
 * A "general" donation is a standalone contribution not attached to a
 * specific bib — the third landing-page CTA ("Just donate"). Distinct
 * from bib sponsorship (Phase 22-01) which increments a Bib row's
 * paidAmount + paidStatusHistory.
 *
 * Lives on the shared `run-human-electro` table alongside Bib +
 * BibReconcile + BudgetCounter (single-table design).
 *
 * Design contract (v1.5 Phase 22-05 PLAN.md §22-05-02):
 * - donationId (PK) — deterministic string derived from stripeSessionId
 *   for Stripe donations (so at-least-once webhook retries dedupe
 *   naturally via ElectroDB's conditional-create). For future Venmo /
 *   CashApp general-donation paths, generated ULID or receiptId hash.
 * - ownerSub — nullable. For MVP the checkout route requires a session
 *   (auditability), but the entity design permits truly-anonymous rows
 *   for a future v1.6 anonymous-donation flow.
 * - amountCents — cents integer (Stripe amount_total).
 * - provider — "stripe" | "venmo" | "cashapp". MVP wires only "stripe";
 *   Venmo / CashApp general-donation paths are deferred to v1.6 (see
 *   PLAN-22-05.md §"Design gaps flagged").
 * - stripeSessionId — nullable (venmo / cashapp paths won't have one).
 *   Set for Stripe donations so webhook retries can idempotently look
 *   up by session id.
 * - reconciledVia — provenance marker: for Stripe use
 *   `stripe_webhook_${session.id}` (mirrors the Bib.applyPayment marker
 *   convention). For future Venmo/CashApp: `haiku_reconcile_${receiptId}`.
 * - createdAt — ISO8601, auto-set. No updatedAt: rows are immutable
 *   post-create (donations are ledger entries, not mutable state).
 *
 * NB: no `notes` / `email` fields. The Stripe Checkout Session captures
 * name+email server-side (Stripe dashboard) — we don't duplicate PII in
 * DDB. Admin support tooling looks up donor identity via the Stripe
 * dashboard using the stripeSessionId.
 */
export const GeneralDonation = new Entity(
  {
    model: {
      entity: "GeneralDonation",
      version: "1",
      service: "run",
    },
    attributes: {
      donationId: {
        type: "string",
        required: true,
      },
      ownerSub: {
        type: "string",
        // Nullable: MVP requires session but the entity permits anonymous
        // rows for a future truly-anonymous flow.
      },
      amountCents: {
        type: "number",
        required: true,
      },
      provider: {
        type: ["stripe", "venmo", "cashapp"] as const,
        required: true,
      },
      stripeSessionId: {
        type: "string",
        // Nullable for future Venmo/CashApp paths.
      },
      reconciledVia: {
        type: "string",
        required: true,
      },
      createdAt: {
        type: "string",
        default: () => new Date().toISOString(),
        readOnly: true,
      },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["donationId"] },
        sk: { field: "sk", composite: [] },
      },
    },
  },
  { client: electroClient, table: ELECTRO_TABLE }
);

export type GeneralDonationItem = EntityItem<typeof GeneralDonation>;

/**
 * Compute the deterministic donationId for a Stripe donation. Using the
 * Stripe Session ID directly (with a `stripe:` prefix so future venmo/
 * cashapp donation keys don't collide) means the entity's conditional
 * create dedupes automatically on webhook retries — Stripe fires the
 * SAME session id, the second `.create()` conditional-check-fails, and
 * we short-circuit as "already recorded".
 *
 * Exported so tests + future admin tooling can compute the same key.
 */
export function stripeSessionDonationId(sessionId: string): string {
  return `stripe:${sessionId}`;
}

/**
 * Input for {@link recordDonation}.
 */
export interface RecordDonationInput {
  /**
   * Deterministic key. For Stripe use {@link stripeSessionDonationId}.
   * Caller passes it in so the SUT stays pure (no coupling to Stripe
   * SDK types inside the entity module).
   */
  donationId: string;
  /**
   * OIDC subject of the donor. `null` for anonymous donations
   * (future v1.6). MVP checkout routes always pass a non-null value.
   */
  ownerSub: string | null;
  amountCents: number;
  provider: "stripe" | "venmo" | "cashapp";
  stripeSessionId?: string | null;
  reconciledVia: string;
}

/**
 * Idempotently record a general donation.
 *
 * Design contract:
 * - Deterministic PK: `donationId` (see {@link stripeSessionDonationId}).
 * - Duplicate deliveries (Stripe retries the same session on any 5xx)
 *   collide on the fixed PK. ElectroDB surfaces this as a
 *   ConditionalCheckFailedException — we catch it, read back the existing
 *   row, and return it. Caller can treat both first-write and dedupe as
 *   success without special-casing.
 * - Never mutates an existing row. Ledger semantics: once written, the
 *   donation is history.
 * - Amount clamped to non-negative whole cents (defensive, matches
 *   Bib.applyPayment's shape).
 */
export async function recordDonation(
  input: RecordDonationInput
): Promise<GeneralDonationItem> {
  const amountCents = Math.max(0, Math.trunc(input.amountCents));

  // ElectroDB rejects `undefined` for optional-but-untyped attributes.
  // Build the payload conditionally so we never write literal `undefined`.
  const payload: Record<string, unknown> = {
    donationId: input.donationId,
    amountCents,
    provider: input.provider,
    reconciledVia: input.reconciledVia,
  };
  if (input.ownerSub !== null && input.ownerSub !== undefined) {
    payload.ownerSub = input.ownerSub;
  }
  if (input.stripeSessionId) {
    payload.stripeSessionId = input.stripeSessionId;
  }

  try {
    const result = await GeneralDonation.create(
      payload as Parameters<typeof GeneralDonation.create>[0]
    ).go();
    return result.data;
  } catch (err) {
    // ConditionalCheckFailed means the same donationId is already in
    // the ledger — Stripe retry, at-least-once S3 event delivery, etc.
    // Read back the existing row and return it as if we'd just written.
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

    const existing = await getDonation(input.donationId);
    if (!existing) {
      throw new Error(
        `recordDonation collision for donationId=${input.donationId} but re-read returned null`
      );
    }
    return existing;
  }
}

/**
 * Fetch a donation ledger row by donationId. Returns null if none exists.
 */
export async function getDonation(
  donationId: string
): Promise<GeneralDonationItem | null> {
  const result = await GeneralDonation.get({ donationId }).go();
  return result.data ?? null;
}

/**
 * List donation rows for a specific ownerSub.
 *
 * NOTE: no GSI on ownerSub in the shared electro-table schema (the three
 * shared GSIs are already claimed — see bib-reconcile.ts docblock for
 * the same rationale). This helper implements the lookup via
 * ElectroDB's scan-based query with a filter on ownerSub. Fine for the
 * v1.5 admin surface (small row count), but scales poorly — a future
 * v1.6 admin dashboard would want a purpose-built GSI.
 *
 * Anonymous donations (ownerSub === null) are excluded from this scan
 * by contract; use {@link getDonation} to fetch anonymous rows by their
 * donationId directly.
 */
export async function listDonationsForOwner(
  ownerSub: string
): Promise<GeneralDonationItem[]> {
  const result = await GeneralDonation.scan
    .where(({ ownerSub: attr }, { eq }) => eq(attr, ownerSub))
    .go();
  return result.data;
}
