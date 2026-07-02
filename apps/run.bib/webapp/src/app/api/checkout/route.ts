import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/config/auth";
import { getBib } from "@/entities/bib";
import { getStripeClient } from "@/lib/stripe";

/**
 * POST /api/checkout — create a Stripe Checkout Session for the signed-in
 * user and return the session URL so the client can redirect the browser.
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-01-03 + CONTEXT.md
 * "Locked design decisions"):
 * - Stripe Checkout redirect flow (NOT Elements). Dynamic price at API
 *   call time — no Stripe dashboard Products config.
 * - Auth guard: session required. Client-supplied `owner_sub` is never
 *   trusted; `session.user.id` is the only PK source.
 * - Zod bounds match SponsorForm.clampAmountCents (100..100000 cents).
 *   Provider is `z.literal("stripe")` — Venmo / CashApp handoff is
 *   client-side (Plan 22-02); the server MUST reject non-Stripe here.
 * - Metadata: `{owner_sub, runner_code, source: "bib"}` (snake_case
 *   because Stripe metadata keys are opaque strings — snake_case matches
 *   the webhook read-back in Plan 22-01-04).
 * - success_url / cancel_url: `${BIB_PUBLIC_URL}/use1/?status=success|cancel`
 *   with the regional prefix HARD-CODED because Stripe Checkout URLs are
 *   baked at Session-create time — the client will hit them on a fresh
 *   navigation that misses the Next.js basePath rewriting layer.
 * - Runtime: Node.js (default for Next.js API routes) — the Stripe SDK
 *   needs Node.js `crypto`, though this route doesn't verify signatures.
 *   The webhook route explicitly pins `runtime = "nodejs"` for that
 *   reason; this route is safe as the framework default.
 * - Return shape: `{ session_url: string }` on 200; error JSON on all
 *   non-2xx paths. Client only cares about `session_url` — the id is
 *   available in the Stripe dashboard for support.
 */

const bodySchema = z.object({
  amount_cents: z.number().int().min(100).max(100_000),
  provider: z.literal("stripe"),
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
  // the right bib). If the user hits POST /api/checkout without a bib,
  // that's a workflow bug — the landing page always POSTs to /api/bib
  // first. 409 keeps it distinct from `unauthorized` (401).
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
    console.error("[run.bib] /api/checkout: getStripeClient failed:", err);
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
            product_data: {
              name: "DEF CON 34 Run — bib sponsorship",
              description: `Sponsorship for runner ${bib.runnerCode}`,
            },
          },
        },
      ],
      metadata: {
        owner_sub: ownerSub,
        runner_code: bib.runnerCode,
        source: "bib",
      },
      // Regional /use1/ prefix baked in — Stripe redirects the browser
      // straight to the URL; Next.js basePath rewriting doesn't fire.
      success_url: `${base}/use1/?status=success`,
      cancel_url: `${base}/use1/?status=cancel`,
    });

    if (!stripeSession.url) {
      // Should never happen for `mode: "payment"` sessions but Stripe
      // types allow `url: null` when the session is embedded (Elements).
      // Surface as 500 rather than hand the client a null URL.
      console.error(
        "[run.bib] /api/checkout: Stripe returned session without url",
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
    console.error("[run.bib] /api/checkout: Stripe session create failed:", err);
    return NextResponse.json(
      { error: "stripe_create_failed" },
      { status: 500 }
    );
  }
}
