import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import GetYourBib from "@/components/GetYourBib";
import { ContributionTiles } from "@/components/ContributionTiles";
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

  // hasTransacted = any money at all (bib payment OR donation). Kept ONLY for
  // the DRAFT stamp (a donation counts as "committed" — clears DRAFT). It does
  // NOT gate the bib actions: donations are purely additive (Kurt 2026-07-05).
  const hasTransacted = hasSponsored || donationTotal > 0;

  // Pay-in-person state, threaded to the choice control (in the tile grid) and
  // used to seed the bib preview's cash-rain on load.
  const willPayInitial = bib.willPayInPerson === true;
  // Show the pledge/burn checkboxes UNLESS they've actually PAID FOR THE BIB
  // (sponsored). A donation must NOT hide them (Kurt 2026-07-05) — a donor can
  // still pledge $20 in person or torch their bib. Once they've paid online, the
  // in-person pledge / burn are moot, so the whole control hides.
  const showCheckbox = !hasSponsored;
  // WR-02: seed the cash-rain from the SAME gate that shows the control.
  // willPayInPerson is never cleared in the DB when money moves (A4 "drop the
  // pledge" is realized by hiding the control, not mutating the flag), so a
  // runner who pledged in-person AND later paid online would otherwise load
  // with rain stuck on and no control to turn it off. Only seed rain while the
  // pledge is still actionable.
  const initialRaining = showCheckbox && willPayInitial;

  // 🔥 Burn opt-out (Kurt 2026-07-05). Persisted on bib.burned. Suppress the
  // burning view only once they've PAID FOR THE BIB (sponsored) — a paid bib
  // shows normally even if torched earlier. A donation does NOT un-burn (a donor
  // who doesn't want a bib still doesn't want one).
  const initialBurning = bib.burned === true && !hasSponsored;
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
        <p style={{ margin: 0, color: "var(--bib-muted)", fontSize: 15 }}>
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

        {/* Sponsor / Donate tiles — CLIENT-reactive to the pledge (Kurt
          * 2026-07-05): ticking/un-ticking pay-in-person instantly swaps the
          * tiles, disables/re-enables Sponsor, and starts/stops the tile rain via
          * the rain/burn stores — no reload, no server round-trip. */}
        <ContributionTiles
          hasSponsored={hasSponsored}
          initialRaining={initialRaining}
          initialBurning={initialBurning}
          runnerCode={bib.runnerCode}
        />
      </div>
  );
}
