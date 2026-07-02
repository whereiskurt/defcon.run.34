import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/config/auth";
import { getBib } from "@/entities/bib";
import { getStripeClient } from "@/lib/stripe";
import { STRIPE_PRODUCT_BIB } from "@/config/stripe-products";

/**
 * POST /api/checkout/bib — create a Stripe Checkout Session for a bib
 * sponsorship (Phase 22-05 rescope of the original /api/checkout).
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-01-03 + Phase 22-05 §22-05-03):
 * - Stripe Checkout redirect flow (NOT Elements). Dynamic price at API
 *   call time — no Stripe dashboard Products config.
 * - Auth guard: session required. Client-supplied `owner_sub` is never
 *   trusted; `session.user.id` is the only PK source.
 * - Zod bounds match SponsorForm.clampAmountCents (100..100000 cents).
 * - Metadata (Phase 22-05):
 *     - `donation_type: "bib"` — the webhook keys on this to route the
 *       payment to Bib.applyPayment (vs. GeneralDonation.recordDonation).
 *     - `owner_sub`, `runner_code`, `source: "bib"` — retained for
 *       backward compatibility with the Plan 22-01 webhook read-back.
 * - success_url / cancel_url: `${BIB_PUBLIC_URL}/use1/orderform?status=success|cancel`
 *   with the regional prefix HARD-CODED because Stripe Checkout URLs are
 *   baked at Session-create time.
 * - Runtime: Node.js (default for Next.js API routes).
 * - Return shape: `{ session_url: string }` on 200; error JSON on non-2xx.
 *
 * Renamed from `/api/checkout` in Phase 22-05 to make room for
 * `/api/checkout/general` (standalone donations that are NOT attached to
 * a bib).
 */

const bodySchema = z.object({
  amount_cents: z.number().int().min(100).max(100_000),
  // Retained for backward compatibility with pre-22-05 SponsorForm calls.
  // Only `"stripe"` is accepted; Venmo / CashApp handoff is client-side.
  provider: z.literal("stripe").optional(),
});

/**
 * Resolve the fully-qualified success / cancel URL base for Stripe.
 *
 * Stripe stores these URLs on the Session at create time and redirects
 * the browser on payment completion. Because Stripe never sees our
 * Next.js `basePath`, we must include the `/use1/` regional prefix in
 * the URL itself — a relative redirect through Next.js won't happen.
 * Default `https://bib.defcon.run` matches the prod origin; env
 * `BIB_PUBLIC_URL` overrides for staging / preview environments.
 */
function bibPublicUrl(): string {
  const base = process.env.BIB_PUBLIC_URL || "https://bib.defcon.run";
  // Trim any trailing slash so we can safely concatenate `/use1/?status=...`.
  return base.replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", detail: "expected application/json" },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", detail: parsed.error.issues },
      { status: 400 }
    );
  }

  const ownerSub = session.user.id;

  // Runner code is required for reconciliation metadata on the Stripe
  // side (post-payment success reads this back to attach the payment to
  // the right bib). If the user hits POST /api/checkout/bib without a
  // bib, that's a workflow bug — the landing page always POSTs to
  // /api/bib first. 409 keeps it distinct from `unauthorized` (401).
  const bib = await getBib(ownerSub);
  if (!bib) {
    return NextResponse.json(
      { error: "no_bib", detail: "user has no bib yet; POST /api/bib first" },
      { status: 409 }
    );
  }

  let stripe;
  try {
    stripe = await getStripeClient();
  } catch (err) {
    console.error("[run.bib] /api/checkout/bib: getStripeClient failed:", err);
    return NextResponse.json(
      { error: "stripe_unavailable" },
      { status: 500 }
    );
  }

  const base = bibPublicUrl();
  try {
    const stripeSession = await stripe.checkout.sessions.create({
      mode: "payment",
      // Dynamic price: cents in, cents on the session. No Products / no
      // Prices in the Stripe dashboard — the amount is per-request.
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: parsed.data.amount_cents,
            product: STRIPE_PRODUCT_BIB,
          },
        },
      ],
      metadata: {
        // Phase 22-05 branch discriminator — webhook keys on this.
        donation_type: "bib",
        owner_sub: ownerSub,
        runner_code: bib.runnerCode,
        // Retained for backward compat with pre-22-05 admin tooling.
        source: "bib",
      },
      // Regional /use1/ prefix baked in — Stripe redirects the browser
      // straight to the URL; Next.js basePath rewriting doesn't fire.
      success_url: `${base}/use1/orderform?status=success`,
      cancel_url: `${base}/use1/orderform?status=cancel`,
    });

    if (!stripeSession.url) {
      // Should never happen for `mode: "payment"` sessions but Stripe
      // types allow `url: null` when the session is embedded (Elements).
      // Surface as 500 rather than hand the client a null URL.
      console.error(
        "[run.bib] /api/checkout/bib: Stripe returned session without url",
        stripeSession.id
      );
      return NextResponse.json(
        { error: "stripe_no_url" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { session_url: stripeSession.url },
      { status: 200 }
    );
  } catch (err) {
    console.error(
      "[run.bib] /api/checkout/bib: Stripe session create failed:",
      err
    );
    return NextResponse.json(
      { error: "stripe_create_failed" },
      { status: 500 }
    );
  }
}
