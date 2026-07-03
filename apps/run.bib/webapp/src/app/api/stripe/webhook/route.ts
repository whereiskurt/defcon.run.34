import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { applyPayment } from "@/entities/bib";
import {
  recordDonation,
  stripeSessionDonationId,
} from "@/entities/general-donation";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";
import { consumeQuota } from "@/lib/quota-client";

/**
 * POST /api/stripe/webhook — verify signature + branch on donation_type.
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-01-04, extended by Phase
 * 22-05 §22-05-03):
 * - NO auth session — Stripe signs the request via `whsec_*`. The
 *   `Stripe-Signature` header + raw body are verified against the
 *   webhook signing secret (`getStripeWebhookSecret()` — SSM-backed).
 * - `runtime = "nodejs"` (below) — Stripe SDK needs Node `crypto` for
 *   HMAC-SHA256 signature verification. Edge runtime lacks it.
 * - Raw body is read via `req.text()` BEFORE any JSON parsing.
 *   Stripe's `constructEvent` re-hashes the raw bytes.
 * - Handled event: `checkout.session.completed`. Phase 22-05 branches
 *   on `session.metadata.donation_type`:
 *     - "bib"     → `applyPayment(ownerSub, {...})` (Plan 22-01 path).
 *     - "general" → `recordDonation({...})` (Plan 22-05-02 entity).
 *     - unknown / missing → log warn, 200 (don't retry — the session
 *       came from outside our flow or metadata is corrupted).
 *   Both paths are idempotent by their respective markers
 *   (reconciled_via for bib; donationId for general).
 * - Response codes:
 *     - 400 for bad signature (Stripe stops retrying — request is
 *       malformed or the whsec is wrong; retrying won't help).
 *     - 503 in "placeholder mode" (whsec not yet loaded into SSM /
 *       env). This signals "infra not ready" — Stripe will retry.
 *     - 500 on entity failure (DDB write blew up). Stripe retries.
 *     - 200 on success OR unhandled event types (Stripe would retry
 *       forever otherwise; unknown event types are logged and dropped).
 *
 * Placeholder-mode detection: if `getStripeWebhookSecret()` throws AND
 * the error path indicates no env / no SSM value, respond 503 with
 * `webhook signing secret not configured`. Only true SSM/AWS infra
 * failures should fall through to 500.
 */

// Force Node.js runtime so Stripe's `crypto`-based signature verify works.
export const runtime = "nodejs";
// Disable static optimization: raw body handling requires a per-request stream.
export const dynamic = "force-dynamic";

/**
 * Distinguish "placeholder mode" (no env, no SSM value) from a real AWS
 * infra failure. Placeholder mode is a Kurt-side gate ("SSM not loaded
 * yet") — we return 503 so Stripe retries after the SSM param lands.
 * A true infra failure surfaces a 500.
 *
 * SSM `ParameterNotFound` is the fingerprint we key on. Any other
 * error (network, IAM, throttling) counts as a real infra failure.
 */
function isPlaceholderModeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = (err as { name?: string }).name;
  if (name === "ParameterNotFound") return true;
  // getSecureParam throws a synthetic Error when both env and SSM
  // return empty. Match on the message prefix — a bit brittle but the
  // only signal we have short of a typed error class.
  return err.message.includes("SSM parameter") &&
    err.message.includes("returned no Value");
}

/**
 * Handle a `checkout.session.completed` event whose metadata.donation_type
 * is `"bib"`. Mirrors the Plan 22-01 semantics: extract owner_sub +
 * amount_total, call applyPayment, and translate errors into HTTP shapes.
 */
async function handleBibDonation(
  session: Stripe.Checkout.Session
): Promise<NextResponse> {
  const ownerSub = session.metadata?.owner_sub;
  const amountTotal = session.amount_total;

  if (!ownerSub) {
    console.warn(
      `[run.bib] /api/stripe/webhook: bib session ${session.id} has no metadata.owner_sub — skipping`
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (typeof amountTotal !== "number" || amountTotal <= 0) {
    console.warn(
      `[run.bib] /api/stripe/webhook: bib session ${session.id} amount_total=${amountTotal} — skipping`
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    await applyPayment(ownerSub, {
      provider: "stripe",
      amount_cents: amountTotal,
      reconciled_via: `stripe_webhook_${session.id}`,
    });
    // Count the completed purchase against the bib_purchase quota. Best-effort:
    // a quota-service hiccup must never fail the webhook (which would make
    // Stripe retry applyPayment and double-charge the ledger).
    await consumeQuota(ownerSub, "bib_purchase", 1, "upload").catch((e) =>
      console.warn(`[run.bib] bib_purchase quota consume failed: ${e}`)
    );
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    // Bib not found — respond 200 so Stripe stops retrying (the bib
    // doesn't exist and never will for this session), and log for
    // manual reconciliation.
    if (err instanceof Error && err.message.startsWith("No bib found")) {
      console.warn(
        `[run.bib] /api/stripe/webhook: no bib for owner_sub=${ownerSub} (session ${session.id})`
      );
      return NextResponse.json({ received: true }, { status: 200 });
    }
    console.error(
      "[run.bib] /api/stripe/webhook: applyPayment failed:",
      err
    );
    // 500 so Stripe retries on transient DDB failures.
    return NextResponse.json(
      { error: "apply_failed" },
      { status: 500 }
    );
  }
}

/**
 * Handle a `checkout.session.completed` event whose metadata.donation_type
 * is `"general"` (Phase 22-05). Writes an idempotent GeneralDonation
 * ledger row keyed by the Stripe session id.
 */
async function handleGeneralDonation(
  session: Stripe.Checkout.Session
): Promise<NextResponse> {
  const amountTotal = session.amount_total;
  // owner_sub is nullable at the entity layer (v1.6 anon support); MVP
  // routes populate it from the session. If it's missing, we still
  // record the donation but write ownerSub as null.
  const ownerSub = session.metadata?.owner_sub ?? null;

  if (typeof amountTotal !== "number" || amountTotal <= 0) {
    console.warn(
      `[run.bib] /api/stripe/webhook: general session ${session.id} amount_total=${amountTotal} — skipping`
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    await recordDonation({
      donationId: stripeSessionDonationId(session.id),
      ownerSub,
      amountCents: amountTotal,
      provider: "stripe",
      stripeSessionId: session.id,
      reconciledVia: `stripe_webhook_${session.id}`,
    });
    // Count the completed donation against the donation quota (owner rows only).
    if (ownerSub) {
      await consumeQuota(ownerSub, "donation", 1, "upload").catch((e) =>
        console.warn(`[run.bib] donation quota consume failed: ${e}`)
      );
    }
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error(
      "[run.bib] /api/stripe/webhook: recordDonation failed:",
      err
    );
    return NextResponse.json(
      { error: "donation_record_failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    // No signature header at all — reject as bad request. This isn't
    // a "retry me" scenario; it's a client-side misconfig or a probe.
    return NextResponse.json(
      { error: "missing_signature" },
      { status: 400 }
    );
  }

  // Read raw body BEFORE any parsing — Stripe re-hashes the exact
  // bytes we received.
  const rawBody = await req.text();

  let whsec: string;
  try {
    whsec = await getStripeWebhookSecret();
  } catch (err) {
    if (isPlaceholderModeError(err)) {
      console.warn(
        "[run.bib] /api/stripe/webhook: signing secret not configured — 503"
      );
      return NextResponse.json(
        { error: "webhook signing secret not configured" },
        { status: 503 }
      );
    }
    console.error(
      "[run.bib] /api/stripe/webhook: getStripeWebhookSecret failed:",
      err
    );
    return NextResponse.json(
      { error: "webhook_secret_unavailable" },
      { status: 500 }
    );
  }

  let stripe;
  try {
    stripe = await getStripeClient();
  } catch (err) {
    if (isPlaceholderModeError(err)) {
      return NextResponse.json(
        { error: "stripe secret key not configured" },
        { status: 503 }
      );
    }
    console.error(
      "[run.bib] /api/stripe/webhook: getStripeClient failed:",
      err
    );
    return NextResponse.json(
      { error: "stripe_unavailable" },
      { status: 500 }
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, whsec);
  } catch (err) {
    // Signature verification failed — Stripe stops retrying on 400.
    // Log the error for observability but never leak the raw sig or
    // whsec in structured logs.
    console.warn(
      "[run.bib] /api/stripe/webhook: signature verification failed:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "signature_invalid" },
      { status: 400 }
    );
  }

  // Only handle checkout.session.completed for now. Other event types
  // (dispute, refund) can be wired in a follow-up plan when the admin
  // surface exists to act on them.
  if (event.type !== "checkout.session.completed") {
    console.log(
      `[run.bib] /api/stripe/webhook: dropping event type ${event.type}`
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const donationType = session.metadata?.donation_type;

  // Phase 22-05: branch on donation_type. Sessions created by
  // /api/checkout/bib set donation_type='bib'; /api/checkout/general
  // sets 'general'. Missing / unknown values are logged and 200'd so
  // Stripe stops retrying (sessions from outside our flow, e.g. a
  // manual dashboard test, are dropped without error).
  if (donationType === "bib") {
    return handleBibDonation(session);
  }
  if (donationType === "general") {
    return handleGeneralDonation(session);
  }

  console.warn(
    `[run.bib] /api/stripe/webhook: session ${session.id} has metadata.donation_type=${donationType ?? "<missing>"} — skipping`
  );
  return NextResponse.json({ received: true }, { status: 200 });
}
