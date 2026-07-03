import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import { getBib } from "@/entities/bib";
import { DEV_MOCK_SESSION, devMockBib, isDevAuthBypass } from "@/lib/dev-auth";
import { getCashAppHandle } from "@/lib/handles";
import { parseAmountCentsFromQuery } from "@/lib/amount";
import SponsorInstructions from "@/components/SponsorInstructions";

/**
 * /sponsor/cashapp — Cash App payment instructions page.
 *
 * Server component. Reads:
 *   1. auth() — session guard (belt-and-suspenders; middleware also gates).
 *   2. getBib(session.user.id) — resolves the user's runnerCode.
 *   3. getCashAppHandle() — SSM `/dc34/secrets/use1/bib/cashapp/handle`,
 *      env fallback `BIB_CASHAPP_HANDLE`, default `$defconrun`.
 *   4. searchParams.amount_cents — clamped to $1..$1000 via
 *      parseAmountCentsFromQuery (same contract as SponsorForm).
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-02-02 + prompt spec):
 * - Landing target for SponsorForm's "Cash App" branch (Plan 22-02-03).
 * - Mirror of the Venmo page — identical shell, different provider
 *   plumbing. Kept as a separate file so per-provider tweaks (e.g.,
 *   Cash App note wording differs from Venmo's private-comment note)
 *   don't require conditional branches inside a shared page.
 * - Deep link uses the `https://cash.app/$<handle>` URL scheme —
 *   this is Cash App's canonical share link; on mobile it opens the
 *   app if installed, on desktop it renders the cash.app profile
 *   page (which is a safe UX fallback).
 */
type CashAppPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function CashAppInstructionsPage({
  searchParams,
}: CashAppPageProps) {
  const bypass = isDevAuthBypass();
  const session = bypass ? DEV_MOCK_SESSION : await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }

  const ownerSub = session.user.id;
  const bib = bypass ? devMockBib() : await getBib(ownerSub);
  if (!bib) {
    // Bootstrap edge case: user reached /sponsor/cashapp without going
    // through the landing page bib bootstrap. Send them home so the
    // landing page can idempotently create a bib for them, then they
    // can re-enter the sponsor flow.
    redirect("/orderform");
  }

  const params = (await searchParams) ?? {};
  const amountCents = parseAmountCentsFromQuery(params.amount_cents);
  const handle = await getCashAppHandle();

  // Cash App share-link contract:
  //   https://cash.app/$<handle-no-$>/<amount-dollars>
  // Mobile: opens the Cash App with prefilled recipient + amount. The
  // note has to be added by the user in the app (Cash App URL scheme
  // does not accept a `note` query in the public share link — Kurt
  // 2026-07-02 verified). The BIB-XXXX code stays visible on-page as
  // the "Required note" so the user copies it manually.
  const handleForDeepLink = handle.startsWith("$") ? handle.slice(1) : handle;
  const amountDollars = (amountCents / 100).toFixed(2);
  const deepLink = `https://cash.app/$${encodeURIComponent(
    handleForDeepLink
  )}/${amountDollars}`;

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#e4e4ef",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "48px 20px 96px",
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1
            style={{
              fontSize: 32,
              margin: 0,
              fontWeight: 800,
              letterSpacing: "0.01em",
            }}
          >
            Sponsor via Cash App
          </h1>
          <p style={{ margin: 0, color: "#a4a4b8", fontSize: 15 }}>
            DEF CON 34 — send the amount below and paste your runner
            code as the note before you tap send.
          </p>
        </header>

        <SponsorInstructions
          providerLabel="Cash App"
          handle={handle}
          runnerCode={bib.runnerCode}
          amountCents={amountCents}
          deepLink={deepLink}
        />

        <p style={{ margin: 0, color: "#8f8fa8", fontSize: 13 }}>
          <a
            href="/"
            style={{ color: "#8f8fa8", textDecoration: "underline" }}
          >
            ← Back to bib
          </a>
        </p>
      </div>
    </main>
  );
}
