import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/config/auth";
import { getStripeClient } from "@/lib/stripe";
import { STRIPE_PRODUCT_GENERAL } from "@/config/stripe-products";
import { checkQuota, type QuotaTier } from "@/lib/quota-client";

/**
 * POST /api/checkout/general — create a Stripe Checkout Session for a
 * standalone "just donate" contribution not attached to any bib
 * (Phase 22-05, Kurt 2026-07-02 rescope).
 *
 * Design contract (v1.5 Phase 22-05 PLAN.md §22-05-03):
 * - Same Stripe Checkout redirect flow as /api/checkout/bib. Reuses
 *   getStripeClient() (SSM-backed singleton).
 * - Auth guard: MVP requires session for auditability (design gap #1
 *   in PLAN-22-05.md — truly-anonymous flow deferred to v1.6). If the
 *   session is missing, 401. Once a v1.6 anon path is added, this
 *   handler will need a separate branch.
 * - Zod bounds match /api/checkout/bib: 100..100000 cents ($1..$1000).
 * - Metadata (Phase 22-05):
 *     - `donation_type: "general"` — the webhook keys on this to route
 *       the payment to GeneralDonation.recordDonation (vs. the bib
 *       branch).
 *     - `owner_sub` — set from session.user.id. Once anon rows are
 *       supported the field becomes optional.
 * - Return shape: `{ session_url: string }` on 200; error JSON on
 *   non-2xx.
 *
 * Product name / description are intentionally "defcon.run 34 —
 * general donation" (naming sweep from Task 22-05-05 also applies here
 * — pre-emptively named at coin toss).
 */

const bodySchema = z.object({
  amount_cents: z.number().int().min(1_000).max(100_000), // $10 donation minimum
});

/**
 * Duplicate of /api/checkout/bib's helper. Two-line function; not worth
 * factoring into a shared module until a third checkout route lands.
 */
function bibPublicUrl(): string {
  // BIB_PUBLIC_URL already includes the region prefix (e.g. https://bib.defcon.run/use1),
  // so success/cancel URLs append just /orderform — do NOT re-add /use1 (caused /use1/use1).
  const base = process.env.BIB_PUBLIC_URL || "https://bib.defcon.run/use1";
  return base.replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  // MVP: session required. See PLAN-22-05.md §"Design gaps flagged" #1
  // for the anon-donation deferral rationale.
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

  // Block starting a donation once the donation quota is spent.
  {
    const services = (session.user as { services?: string[] }).services ?? [];
    const tier: QuotaTier = services.includes("admin") ? "admin" : "upload";
    let atLimit = false;
    let remaining = -1;
    try {
      const q = await checkQuota(ownerSub, "donation", 1, tier);
      atLimit = !q.allowed;
      remaining = q.remaining;
    } catch {
      // quota service unavailable — fail open; completion still consumes it
    }
    if (atLimit) {
      return NextResponse.json(
        { error: "donation_limit_reached", remaining },
        { status: 429 }
      );
    }
  }

  let stripe;
  try {
    stripe = await getStripeClient();
  } catch (err) {
    console.error(
      "[run.bib] /api/checkout/general: getStripeClient failed:",
      err
    );
    return NextResponse.json(
      { error: "stripe_unavailable" },
      { status: 500 }
    );
  }

  const base = bibPublicUrl();
  try {
    const stripeSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: parsed.data.amount_cents,
            product: STRIPE_PRODUCT_GENERAL,
          },
        },
      ],
      metadata: {
        // Phase 22-05 branch discriminator — webhook keys on this.
        donation_type: "general",
        owner_sub: ownerSub,
      },
      success_url: `${base}/orderform?status=success`,
      cancel_url: `${base}/orderform?status=cancel`,
    });

    if (!stripeSession.url) {
      console.error(
        "[run.bib] /api/checkout/general: Stripe returned session without url",
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
      "[run.bib] /api/checkout/general: Stripe session create failed:",
      err
    );
    return NextResponse.json(
      { error: "stripe_create_failed" },
      { status: 500 }
    );
  }
}
