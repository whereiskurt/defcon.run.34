import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import GetYourBib from "@/components/GetYourBib";
import SponsorForm from "@/components/SponsorForm";
import { CashRain } from "@/components/CashRain";
import { ContributionChoice } from "@/components/ContributionChoice";
import { PledgeTagline } from "@/components/PledgeTagline";
import { StripeStatusBanner } from "@/components/StripeStatusBanner";
import { createBib, getBib, type BibItem } from "@/entities/bib";
import { listDonationsForOwner } from "@/entities/general-donation";
import { listPendingForOwner } from "@/entities/pending-contribution";
import { checkQuota } from "@/lib/quota-client";
import TransactionHistory, { type Txn } from "@/components/TransactionHistory";
import { generateUniqueRunnerCode } from "@/lib/runner-code";
import { getSocialQrHash, buildSocialQrUrl } from "@/lib/social-qr";

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

  // Disable the "Sponsor this bib" tile + swap Donate above it when the runner
  // has paid, pledged in person, OR torched their bib (Kurt 2026-07-05 — burn
  // does the same disable+swap as pay-in-person). The "Just donate" flow always
  // stays available.
  const isBurned = bib.burned === true;
  const hideBuyBib =
    hasSponsored || bib.willPayInPerson === true || isBurned;

  // Remaining bib-name changes from the central quota service (run.auth).
  // Fall back to the default limit if the service is briefly unavailable —
  // a quota blip must not 500 the bib page; the server enforces on write.
  const services = (session.user as { services?: string[] }).services ?? [];
  const tier = services.includes("admin") ? "admin" : "upload";
  let renamesRemaining = 30;
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

  // Social-QR (Plan 34-04, Slice C — C-T3): best-effort resolve the runner's
  // real per-user social-QR hash from run.human and build the `/r?h=` URL to
  // encode on the bib tear-off stubs. getSocialQrHash is null-safe (a miss /
  // timeout never 500s the orderform — T-34-07), and BibPreview falls back to
  // the runner-code QR when socialQrUrl is absent (never a blank stub — SC34.8).
  const socialQrHash = await getSocialQrHash(ownerSub);
  const socialQrUrl = socialQrHash ? buildSocialQrUrl(socialQrHash) : undefined;

  // A4 (Kurt 2026-07-03): once any money has moved for this bib, drop the
  // "I'll pay in person" pledge — it's only meaningful pre-payment.
  const hasTransacted = hasSponsored || donationTotal > 0;

  // Pay-in-person state, threaded to the choice control (in the tile grid) and
  // used to seed the bib preview's cash-rain on load.
  const willPayInitial = bib.willPayInPerson === true;
  const showCheckbox = !hasTransacted;
  // WR-02: seed the cash-rain from the SAME gate that shows the control.
  // willPayInPerson is never cleared in the DB when money moves (A4 "drop the
  // pledge" is realized by hiding the control, not mutating the flag), so a
  // runner who pledged in-person AND later paid online would otherwise load
  // with rain stuck on and no control to turn it off. Only seed rain while the
  // pledge is still actionable.
  const initialRaining = showCheckbox && willPayInitial;

  // 🔥 Burn opt-out (Kurt 2026-07-05). Persisted on bib.burned. Suppress the
  // burning view once money has moved so a sponsored bib shows normally even if
  // it was torched earlier (the flag lingers in the DB but is irrelevant then).
  const initialBurning = bib.burned === true && !hasTransacted;
  // Seed the 3-way control: burn wins, then pledge, else nothing.
  const initialChoice: "nothing" | "inperson" | "burn" = initialBurning
    ? "burn"
    : willPayInitial
      ? "inperson"
      : "nothing";

  return (
    // Transparent container — the root layout now paints the dark background,
    // the Vegas parallax, and the glass-nav header around this content.
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: "20px 16px 44px",
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
          Bibs &amp; Donation
        </h1>
        <p style={{ margin: 0, color: "#a4a4b8", fontSize: 15 }}>
          defcon.run remains a FREE daily event — if you&apos;d like to
          financially support, we would appreciate it.
        </p>
      </header>

      {status && <StripeStatusBanner status={status} />}

      {/* Once the bib is sponsored, lead with a big green THANK YOU above the
        * name (Kurt 2026-07-04) — replaces the old inline "you're all set" line. */}
      {hasSponsored && (
        <p
          role="status"
          style={{
            margin: 0,
            textAlign: "center",
            color: "#7fdc9e",
            fontSize: 44,
            fontWeight: 900,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Thank You
        </p>
      )}

      {/* Get your bib — name first (A3), live preview below. GetYourBib is a
        * thin client wrapper; checking "contribute in person" (now in the tile
        * grid below) rains cash over the bib preview via the rain-store
        * singleton (Plan 34-03). */}
      <GetYourBib
        bibForm={{
          initialName: bib.nameOnBib || "",
          nameLocked: bib.nameLocked === true,
          hasSponsored,
          initialRenamesRemaining: renamesRemaining,
          runnerCode: bib.runnerCode,
          initialRaining,
          initialBurning,
          hasTransacted,
          socialQrUrl,
        }}
      />

        <TransactionHistory totalCents={totalCents} txns={txns} />

        {/* Pay-in-person tagline — client-driven (rain-store) so it flips
          * instantly: in person → "OK! You promised 🙏"; burn/nothing → nothing.
          * hasSponsored gets the big THANK YOU up top instead. */}
        {!hasSponsored && <PledgeTagline initialRaining={initialRaining} />}

        {/* Pay-in-person pledge — full-width, ABOVE both tiles (Kurt 2026-07-05).
          * Checking it no longer removes the Sponsor tile; instead the two tiles
          * swap (Donate rises to the top / left) and the Sponsor tile is disabled
          * and dimmed in place. On mobile the effect is: checkbox → Donate →
          * disabled Sponsor at the bottom. Still rains cash over the preview via
          * the rain-store, and the swap is driven by hideBuyBib (pledge or paid). */}
        {showCheckbox && <ContributionChoice initialChoice={initialChoice} />}

        {/* Responsive tile grid (SC34.4): single column on mobile, 2-col ≥640px.
          * `order` utilities apply at every breakpoint so the swap holds on both
          * mobile (top↔bottom) and desktop (left↔right). Only this wrapper uses
          * Tailwind — the tiles keep their inline styles. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Sponsor this bib — order-1 by default; drops below Donate and greys
            * out (disabled + dimmed + inert) once the runner pledges to pay in
            * person or has already paid (hideBuyBib). */}
          <div
            className={hideBuyBib ? "order-2" : "order-1"}
            aria-disabled={hideBuyBib || undefined}
            style={{
              minWidth: 0,
              position: "relative",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            {/* Dim + inert wrapper only around the tile content, so the cash
              * rain overlay below stays at full opacity and interactive-none. */}
            <div
              style={
                hideBuyBib
                  ? { opacity: 0.5, pointerEvents: "none" }
                  : undefined
              }
            >
              <Tile
                kicker="This"
                title="Sponsor this bib"
                body="Contributing to the event helps cover the cost of bibs and other swag. We appreciate your support."
                art={<SponsorArt />}
              >
                <SponsorForm
                  variant="bib"
                  ctaLabel="Sponsor"
                  runnerCode={bib.runnerCode}
                  disabled={hideBuyBib}
                />
              </Tile>
            </div>
            {/* Same "make it rain" charm as the bib preview: once the runner
              * pledges to pay in person and this tile disables, cash rains over
              * it. NOT when burned — a torched bib is fire, not cash. */}
            {hideBuyBib && !isBurned && <CashRain active />}
          </div>

          {/* Just donate — order-2 by default; rises to order-1 (top on mobile,
            * left column on desktop) when the Sponsor tile is disabled. */}
          <div
            className={hideBuyBib ? "order-1" : "order-2"}
            style={{ minWidth: 0 }}
          >
            <Tile
              kicker={hideBuyBib ? "Support" : "or That"}
              title="Just donate"
              body="This long-running event would value any financial support you'd like to give. Every year we try to provide an accessible and memorable event for all."
              art={<DonateArt />}
            >
              <SponsorForm
                variant="general"
                ctaLabel="Donate"
                runnerCode={bib.runnerCode}
              />
            </Tile>
          </div>
        </div>
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
        gap: 10,
        padding: 16,
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
          gap: 6,
          paddingBottom: 2,
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

