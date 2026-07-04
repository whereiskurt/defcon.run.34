import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import GetYourBib from "@/components/GetYourBib";
import SponsorForm from "@/components/SponsorForm";
import { createBib, getBib, type BibItem } from "@/entities/bib";
import { listDonationsForOwner } from "@/entities/general-donation";
import { listPendingForOwner } from "@/entities/pending-contribution";
import { checkQuota } from "@/lib/quota-client";
import TransactionHistory, { type Txn } from "@/components/TransactionHistory";
import { generateUniqueRunnerCode } from "@/lib/runner-code";

/**
 * Home is a server-component route that receives `searchParams` from
 * Next.js at render time. We surface the `?status=success|cancel` toast
 * that Stripe attaches when redirecting the browser back after a
 * Checkout Session completes (Plan 22-01-3 hard-codes those URLs on the
 * Stripe Session at create time).
 *
 * `searchParams` is a Promise in Next.js 16 App Router — awaiting it
 * keeps the render deterministic and avoids the React 19 sync-render
 * warning for accessing a Promise's `.then` inside JSX.
 */
type HomeProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

/**
 * Landing page for run.bib (Phase 22-05 rescope — 2026-07-02).
 *
 * Three-section restructure per Kurt's rescope:
 *   1. "Get your bib" (free registration) — nameOnBib input +
 *      willPayInPerson checkbox. No payment step.
 *   2. "Sponsor this bib" — SponsorForm variant='bib'; posts to
 *      /api/checkout/bib. Sponsor amount attaches to the caller's
 *      bib.paidAmount.
 *   3. "Just donate" — SponsorForm variant='general'; posts to
 *      /api/checkout/general. Standalone GeneralDonation row.
 *
 * Bib bootstrap flow (unchanged from Plan 21-03-03):
 *   1. auth() — verify session, else redirect.
 *   2. getBib(ownerSub) — server-side entity read.
 *   3. If no bib yet: generateUniqueRunnerCode() + createBib.
 *   4. Render.
 *
 * `createBib` is idempotent under ConditionalCheckFailedException, so even
 * if two concurrent tabs POST at the same time only one code wins and both
 * end up reading the same bib.
 */
export default async function Home({ searchParams }: HomeProps) {
  const session = await auth();

  if (!session?.user?.id) {
    // Middleware should have already routed here, but keep the redirect
    // so an accidental middleware regression is a nav failure, not a
    // 500 on session.user.id read.
    redirect("/signin");
  }

  const ownerSub = session.user.id;

  // Fetch — server-side, no HTTP hop needed since we're in-process.
  let bib: BibItem | null = await getBib(ownerSub);

  // Bootstrap: idempotent create on first visit. createBib swallows
  // ConditionalCheckFailedException and returns the existing bib, so this
  // is safe against tab-racing.
  if (!bib) {
    const runnerCode = await generateUniqueRunnerCode();
    bib = await createBib(ownerSub, runnerCode);
  }

  // Read the ?status=success|cancel querystring that Stripe attaches on
  // redirect-back after a Checkout Session. `searchParams` may be
  // undefined in dev when the page renders without any query.
  const params = (await searchParams) ?? {};
  const statusRaw = params.status;
  const status =
    statusRaw === "success" || statusRaw === "cancel" ? statusRaw : null;

  // Phase 22-05-06 sponsor charm accent — threaded through BibForm to
  // BibPreview. Source of truth is server-side bib.paidAmount from the
  // same server-component read above so client + server agree.
  const hasSponsored = (bib.paidAmount ?? 0) > 0;

  // Once the participant has paid for their bib OR opted to pay in person,
  // hide the "Sponsor this bib" (buy) flow — they're covered. The "Just
  // donate" flow always stays available.
  const hideBuyBib = hasSponsored || bib.willPayInPerson === true;

  // Remaining bib-name changes from the central quota service (run.auth).
  // Fall back to the default limit if the service is briefly unavailable —
  // a quota blip must not 500 the bib page; the server enforces on write.
  const services = (session.user as { services?: string[] }).services ?? [];
  const tier = services.includes("admin") ? "admin" : "upload";
  let renamesRemaining = 10;
  try {
    const q = await checkQuota(ownerSub, "bibname_change", 1, tier);
    if (q.remaining >= 0) renamesRemaining = q.remaining;
  } catch {
    // quota service unavailable — show the default
  }

  // Contribution history: reconciled bib payments + donations. Total spend
  // drives the "amount contributed" shown even when the buy flow is hidden.
  const donations = await listDonationsForOwner(ownerSub).catch(() => []);
  const pending = await listPendingForOwner(ownerSub).catch(() => []);
  const donationTotal = donations.reduce(
    (s, d) => s + (d.amountCents ?? 0),
    0
  );
  // Total counts RECONCILED spend only — pending Venmo/CashApp intents are not
  // money in the bank yet, so they're shown separately, not summed.
  const totalCents = (bib.paidAmount ?? 0) + donationTotal;
  const reconciled: Txn[] = [
    ...((bib.paidStatusHistory ?? []) as Array<{
      provider?: string;
      amount?: number;
      timestamp?: string;
    }>).map((p) => ({
      kind: "bib" as const,
      provider: p.provider ?? "stripe",
      amountCents: p.amount ?? 0,
      timestamp: p.timestamp ?? "",
      status: "reconciled" as const,
    })),
    ...donations.map((d) => ({
      kind: "donation" as const,
      provider: d.provider ?? "stripe",
      amountCents: d.amountCents ?? 0,
      timestamp: d.createdAt ?? "",
      status: "reconciled" as const,
    })),
  ].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  // Pending intents float to the top — they're the actionable "did my payment
  // land?" rows the runner is most likely checking for.
  const pendingTxns: Txn[] = pending
    .map((p) => ({
      kind: p.kind,
      provider: p.provider,
      amountCents: p.amountCents ?? 0,
      timestamp: p.createdAt ?? "",
      status: "pending" as const,
    }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const txns: Txn[] = [...pendingTxns, ...reconciled];

  // A4 (Kurt 2026-07-03): once any money has moved for this bib, drop the
  // "I'll pay in person" pledge — it's only meaningful pre-payment.
  const hasTransacted = hasSponsored || donationTotal > 0;

  return (
    // Transparent container — the root layout now paints the dark background,
    // the Vegas parallax, and the glass-nav header around this content.
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 32,
        padding: "32px 20px 64px",
      }}
    >
      {/* A2: single custom page title — the site header already carries the
        * defcon.run wordmark, so no duplicate "Get your bib" headings. */}
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1
          style={{
            fontSize: 30,
            margin: 0,
            fontWeight: 800,
            letterSpacing: "0.01em",
          }}
        >
          run.defcon.run 34 · Bib
        </h1>
        <p style={{ margin: 0, color: "#a4a4b8", fontSize: 15 }}>
          Registration is free — pick the name that prints on your bib.
        </p>
      </header>

      {status && <StripeStatusBanner status={status} />}

      {/* Get your bib — name first (A3), live preview below. GetYourBib is a
        * client wrapper so checking "contribute in person" rains cash over
        * the bib preview (Kurt 2026-07-03). */}
      <GetYourBib
        showCheckbox={!hasTransacted}
        willPayInitial={bib.willPayInPerson === true}
        bibForm={{
          initialName: bib.nameOnBib || "",
          nameLocked: bib.nameLocked === true,
          hasSponsored,
          initialRenamesRemaining: renamesRemaining,
          runnerCode: bib.runnerCode,
        }}
      />

        <TransactionHistory totalCents={totalCents} txns={txns} />

        {/* Sections 2 + 3: Sponsor + Donate. Side-by-side tiles on desktop,
          * stacked on mobile (minWidth:0 lets the grid items shrink below
          * their content's min-content so auto-fit can place two columns).
          * When the bib is already covered (paid or pay-in-person) the buy
          * flow is hidden and only "Just donate" shows, full width. */}
        {hideBuyBib ? (
          <div>
            <p
              style={{
                margin: "0 0 12px",
                color: "#7fdc9e",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {hasSponsored
                ? "You're all set — your bib is covered. Thanks for the support!"
                : "You're paying in person — your bib is reserved."}
            </p>
            <Tile
              kicker="Support"
              title="Just donate"
              body="Contribute anyway — support goes directly to defcon.run 34."
              art={<DonateArt />}
            >
              <SponsorForm
                variant="general"
                ctaLabel="Donate"
                runnerCode={bib.runnerCode}
              />
            </Tile>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 20,
            }}
          >
            <Tile
              kicker="This"
              title="Sponsor this bib"
              body="Contributions attach to your bib and help fund defcon.run 34."
              art={<SponsorArt />}
            >
              <SponsorForm
                variant="bib"
                ctaLabel="Sponsor"
                runnerCode={bib.runnerCode}
              />
            </Tile>
            <Tile
              kicker="or That"
              title="Just donate"
              body="Not running? Contribute anyway — support goes directly to defcon.run 34."
              art={<DonateArt />}
            >
              <SponsorForm
                variant="general"
                ctaLabel="Donate"
                runnerCode={bib.runnerCode}
              />
            </Tile>
          </div>
        )}
      </div>
  );
}

/**
 * Tile wrapper — mirrors the run.defcon.run/meshtastic side-by-side tile
 * pattern (Kurt 2026-07-02 feedback). Header block is centered with a
 * kicker + art + title + body; the CTA (form) sits below.
 */
function Tile({
  kicker,
  title,
  body,
  art,
  children,
}: {
  kicker: string;
  title: string;
  body: string;
  art: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 20,
        borderRadius: 14,
        backgroundColor: "#12121a",
        border: "1px solid #24242e",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          paddingBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7a9dff",
          }}
        >
          {kicker}
        </span>
        <div style={{ color: "#7a9dff" }}>{art}</div>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 800,
            margin: 0,
            letterSpacing: "0.01em",
            textAlign: "center",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: 0,
            color: "#a4a4b8",
            fontSize: 14,
            lineHeight: 1.5,
            textAlign: "center",
          }}
        >
          {body}
        </p>
      </div>
      <div>{children}</div>
    </section>
  );
}

/**
 * Sponsor tile art — stylized bib silhouette with a pin-hole accent and a
 * radial "boost" arc. Original geometric SVG (~50 lines); swap-ready if
 * Kurt drops a bespoke illustration.
 */
function SponsorArt() {
  return (
    <svg
      width="88"
      height="88"
      viewBox="0 0 88 88"
      fill="none"
      aria-hidden="true"
    >
      {/* bib outline */}
      <rect
        x="20"
        y="18"
        width="48"
        height="56"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* pin holes */}
      <circle cx="28" cy="26" r="2.5" fill="currentColor" />
      <circle cx="60" cy="26" r="2.5" fill="currentColor" />
      {/* number pad */}
      <rect
        x="26"
        y="34"
        width="36"
        height="22"
        rx="2"
        fill="currentColor"
        fillOpacity="0.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* perforation */}
      <line
        x1="26"
        y1="62"
        x2="62"
        y2="62"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      {/* stub number */}
      <rect
        x="32"
        y="66"
        width="24"
        height="6"
        rx="1"
        fill="currentColor"
        fillOpacity="0.4"
      />
      {/* boost arc — pointing up + right */}
      <path
        d="M76 14 Q66 6 56 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M56 14 L60 10 M56 14 L60 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Donate tile art — pixel-coin motif. Original geometric SVG; swap-ready.
 */
function DonateArt() {
  return (
    <svg
      width="88"
      height="88"
      viewBox="0 0 88 88"
      fill="none"
      aria-hidden="true"
    >
      {/* coin shadow */}
      <circle
        cx="52"
        cy="52"
        r="20"
        fill="currentColor"
        fillOpacity="0.15"
      />
      {/* coin body */}
      <circle
        cx="44"
        cy="44"
        r="24"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
      />
      {/* inner ring */}
      <circle
        cx="44"
        cy="44"
        r="18"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="4 3"
      />
      {/* dollar mark */}
      <text
        x="44"
        y="52"
        textAnchor="middle"
        fontSize="24"
        fontWeight="900"
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        $
      </text>
      {/* upward sparkles */}
      <circle cx="20" cy="20" r="2" fill="currentColor" fillOpacity="0.7" />
      <circle cx="72" cy="16" r="1.5" fill="currentColor" fillOpacity="0.5" />
      <circle cx="16" cy="72" r="1.5" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}

/**
 * Simple server-rendered banner that acknowledges the Stripe redirect
 * outcome. Not a toast (no client JS needed) — the banner sits above the
 * BibForm until the next navigation clears the query string.
 *
 * Design deliberately minimal: no dismiss button, no auto-hide. Kurt's
 * design contract is to keep the JS surface minimal — a static banner
 * matches every other server-component render pattern in this app.
 */
function StripeStatusBanner({ status }: { status: "success" | "cancel" }) {
  const isSuccess = status === "success";
  const message = isSuccess
    ? "Payment received — thanks for supporting defcon.run 34! Reconciliation may take a moment."
    : "Checkout cancelled. No charge was made — you can try again below.";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: "12px 16px",
        borderRadius: 6,
        backgroundColor: isSuccess ? "#1a3a24" : "#3a2a1a",
        border: `1px solid ${isSuccess ? "#3a7f5c" : "#7f5a3a"}`,
        color: isSuccess ? "#7fdc9e" : "#f4c680",
        fontSize: 14,
      }}
    >
      {message}
    </div>
  );
}
