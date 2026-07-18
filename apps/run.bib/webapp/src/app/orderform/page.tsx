import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import GetYourBib from "@/components/GetYourBib";
import { ContributionTiles } from "@/components/ContributionTiles";
import { ContributionChoice } from "@/components/ContributionChoice";
import { PledgeTagline } from "@/components/PledgeTagline";
import { StripeStatusBanner } from "@/components/StripeStatusBanner";
import { createBib, getBib, type BibItem } from "@/entities/bib";
import {
  getDonationsForOwnerCached,
  getPendingForOwnerCached,
} from "@/lib/report-cache";
import { checkQuota } from "@/lib/quota-client";
import { type Txn } from "@/components/TransactionHistory";
import { ContributionChip } from "@/components/ContributionChip";
import { generateUniqueRunnerCode } from "@/lib/runner-code";
import { getSocialQrHash, buildSocialQrUrl } from "@/lib/social-qr";
import { loadCopy, t } from "@/lib/copy";
import { parseStatus } from "@/lib/order-status";
import { DonationRain } from "@/components/DonationRain";
import BibLockMeter from "./BibLockMeter";

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

  // Bib-name-change tier is read straight off the session's service claims —
  // no I/O — and gates the quota lookup below, so compute it before the fetch.
  const services = (session.user as { services?: string[] }).services ?? [];
  const tier = services.includes("admin") ? "admin" : "upload";

  // All first-paint reads run concurrently: they share only `ownerSub` and none
  // depend on each other. These were previously six SEQUENTIAL awaits (bib GET,
  // quota HTTP, two full-table scans, social-QR HTTP, copy) that serialized into
  // ~2-4s; Promise.all collapses that to the slowest single round-trip. Each
  // keeps its own fail-open fallback so one slow/failed dependency never 500s
  // (or blocks) the page.
  const [bib, params, renamesRemaining, donations, pending, socialQrHash, copy] =
    await Promise.all([
      // Bootstrap: idempotent create on first visit. createBib swallows
      // ConditionalCheckFailedException and returns the existing bib, so this
      // is safe against tab-racing. getBib is in-process (no HTTP hop).
      (async (): Promise<BibItem> => {
        const existing = await getBib(ownerSub);
        if (existing) return existing;
        const runnerCode = await generateUniqueRunnerCode();
        return createBib(ownerSub, runnerCode);
      })(),
      // ?status=success|cancel that Stripe attaches on redirect-back after a
      // Checkout Session. `searchParams` may be undefined in dev with no query.
      Promise.resolve(searchParams).then((p) => p ?? {}),
      // Remaining bib-name changes from the central quota service (run.auth).
      // Fall back to the default limit if the service is briefly unavailable —
      // a quota blip must not 500 the bib page; the server enforces on write.
      checkQuota(ownerSub, "bibname_change", 1, tier)
        .then((q) => (q.remaining >= 0 ? q.remaining : 30))
        .catch(() => 30),
      // Contribution history: reconciled bib payments + donations. Total spend
      // drives the "amount contributed" shown even when the buy flow is hidden.
      // Cached (report-cache, 30s TTL); the .catch keeps a transient scan
      // failure from being cached and falls back to [].
      getDonationsForOwnerCached(ownerSub).catch(() => []),
      getPendingForOwnerCached(ownerSub).catch(() => []),
      // Social-QR (Plan 34-04, Slice C — C-T3): best-effort resolve the runner's
      // real per-user social-QR hash from run.human. getSocialQrHash is null-safe
      // (a miss / timeout never 500s the orderform — T-34-07).
      getSocialQrHash(ownerSub),
      loadCopy("default"),
    ]);

  const status = parseStatus(params.status);

  // Phase 22-05-06 sponsor charm accent — threaded through BibForm to
  // BibPreview. Source of truth is server-side bib.paidAmount from the
  // same server-component read above so client + server agree.
  const hasSponsored = (bib.paidAmount ?? 0) > 0;

  // Disable the "Sponsor this bib" tile + swap Donate above it when the runner
  // has paid, pledged in person, OR torched their bib (Kurt 2026-07-05 — burn
  // does the same disable+swap as pay-in-person). The "Just donate" flow always
  // stays available.
  const isBurned = bib.burned === true;

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
  // Distinct providers that have contributed — feeds the compact chip's tag
  // (e.g. "stripe / venmo"). Order-preserving dedupe over the transaction list.
  const providers = Array.from(
    new Set(txns.map((t) => t.provider).filter(Boolean))
  );

  // socialQrHash (resolved above in the parallel fetch) → the `/r?h=` URL encoded
  // on the bib tear-off stubs. BibPreview falls back to the runner-code QR when
  // socialQrUrl is absent (never a blank stub — SC34.8).
  const socialQrUrl = socialQrHash ? buildSocialQrUrl(socialQrHash) : undefined;

  // hasTransacted = any money at all (bib payment OR donation). Kept ONLY for
  // the DRAFT stamp (a donation counts as "committed" — clears DRAFT). It does
  // NOT gate the bib actions: donations are purely additive (Kurt 2026-07-05).
  const hasTransacted = hasSponsored || donationTotal > 0;

  // Pay-in-person state, threaded to the choice control (in the tile grid) and
  // used to seed the bib preview's cash-rain on load.
  const willPayInitial = bib.willPayInPerson === true;
  // Show the pledge/burn checkboxes UNLESS the runner has ALREADY CONTRIBUTED
  // money — sponsored the bib OR donated (Kurt UI fix; supersedes the 2026-07-05
  // "a donation must not hide them" rule). Once they've given, the "I'll pay $20
  // in person" pledge and the burn opt-out are moot, so the whole control hides.
  const showCheckbox = !hasTransacted;
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
          {t(copy, "bib.landing.title")}
        </h1>
        <p style={{ margin: 0, color: "var(--bib-muted)", fontSize: 15 }}>
          {t(copy, "bib.landing.intro")}
        </p>
        <BibLockMeter label={t(copy, "bib.landing.changeDeadline")} />
      </header>

      {status && <StripeStatusBanner status={status} />}
      {status === "donated" && <DonationRain />}

      {/* Compact contribution chip (Kurt 2026-07-05) — bubbles the THANK YOU +
        * total + payment brands into one pill, above the bib name. Replaces both
        * the big transaction panel and the separate 44px THANK YOU banner. */}
      <ContributionChip totalCents={totalCents} providers={providers} />

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

        {/* Pay-in-person tagline — client-driven (rain-store) so it flips
          * instantly: in person → "OK! You promised 🙏"; burn/nothing → nothing.
          * hasSponsored gets the big THANK YOU up top instead. */}
        {!hasTransacted && <PledgeTagline initialRaining={initialRaining} />}

        {/* Pay-in-person pledge — full-width, ABOVE both tiles (Kurt 2026-07-05).
          * Checking it no longer removes the Sponsor tile; instead the two tiles
          * swap (Donate rises to the top / left) and the Sponsor tile is disabled
          * and dimmed in place. On mobile the effect is: checkbox → Donate →
          * disabled Sponsor at the bottom. Still rains cash over the preview via
          * the rain-store, and the swap is driven by hideBuyBib (pledge or paid). */}
        {showCheckbox && (
          <ContributionChoice
            initialChoice={initialChoice}
            runnerCode={bib.runnerCode}
          />
        )}

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
