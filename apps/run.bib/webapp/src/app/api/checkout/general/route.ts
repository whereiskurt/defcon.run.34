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
 * - Zod bounds match /api/checkout/bib: 100..200000 cents ($1..$2000).
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
  amount_cents: z.number().int().min(1_000).max(200_000), // $10 donation min, $2000 max
});

/**
 * Cross-origin donate (item #2, Kurt 2026-07-05). The quick-donate modal is
 * embedded in run.human / run.flash / gpx and POSTs here cross-subdomain, so
 * this route opts a fixed allowlist of first-party origins into CORS. The
 * session cookie is `.defcon.run`-scoped and run→bib is same-site, so the
 * existing login rides along once `Access-Control-Allow-Credentials` is set
 * (which forbids the `*` wildcard — we must echo the specific origin). Local
 * dev ports are allowed too so the modal can be exercised against a running
 * bib without a deploy; they can never match a real browser origin in prod.
 */
const ALLOWED_ORIGINS = new Set([
  "https://run.defcon.run",
  "https://flash.defcon.run",
  "https://bib.defcon.run",
  "https://gpx.defcon.run",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  }
  return {};
}

/**
 * CORS preflight. A cross-origin POST with `Content-Type: application/json`
 * is non-simple, so the browser sends OPTIONS first. Reflect the allowlisted
 * origin or 403.
 */
export async function OPTIONS(req: NextRequest) {
  const cors = corsHeaders(req.headers.get("origin"));
  if (!cors["Access-Control-Allow-Origin"]) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

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
  // Echo the allowlisted origin on every response so a cross-origin donate
  // modal (run.human / run.flash / gpx) can read both success and error bodies.
  const cors = corsHeaders(req.headers.get("origin"));

  const session = await auth();
  // MVP: session required. See PLAN-22-05.md §"Design gaps flagged" #1
  // for the anon-donation deferral rationale.
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: cors }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", detail: "expected application/json" },
      { status: 400, headers: cors }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", detail: parsed.error.issues },
      { status: 400, headers: cors }
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
        { status: 429, headers: cors }
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
      { status: 500, headers: cors }
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
      success_url: `${base}/orderform?status=donated`,
      cancel_url: `${base}/orderform?status=cancel`,
    });

    if (!stripeSession.url) {
      console.error(
        "[run.bib] /api/checkout/general: Stripe returned session without url",
        stripeSession.id
      );
      return NextResponse.json(
        { error: "stripe_no_url" },
        { status: 500, headers: cors }
      );
    }

    return NextResponse.json(
      { session_url: stripeSession.url },
      { status: 200, headers: cors }
    );
  } catch (err) {
    console.error(
      "[run.bib] /api/checkout/general: Stripe session create failed:",
      err
    );
    return NextResponse.json(
      { error: "stripe_create_failed" },
      { status: 500, headers: cors }
    );
  }
}
