import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import { getBib } from "@/entities/bib";
import { recordPending } from "@/entities/pending-contribution";
import { getVenmoHandle } from "@/lib/handles";
import { parseAmountCentsFromQuery } from "@/lib/amount";
import SponsorInstructions from "@/components/SponsorInstructions";

/**
 * /sponsor/venmo — Venmo payment instructions page.
 *
 * Server component. Reads:
 *   1. auth() — session guard (belt-and-suspenders; middleware also gates).
 *   2. getBib(session.user.id) — resolves the user's runnerCode.
 *   3. getVenmoHandle() — SSM `/dc34/secrets/use1/bib/venmo/handle`,
 *      env fallback `BIB_VENMO_HANDLE`, default `@defconrun`.
 *   4. searchParams.amount_cents — clamped to $1..$1000 via
 *      parseAmountCentsFromQuery (same contract as SponsorForm).
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-02-01 + prompt spec):
 * - Landing target for SponsorForm's "Venmo" branch (Plan 22-02-03).
 * - Runner code MUST appear as the payment note so the reconciliation
 *   Lambda (Plan 22-04) can match receipts back to bibs. If the user
 *   has no bib yet (workflow edge case — they haven't visited the
 *   landing page), redirect them to bootstrap.
 * - Deep link uses the `venmo://paycharge` scheme where supported;
 *   desktop browsers silently no-op, mobile Safari/Chrome hand off to
 *   the Venmo app.
 */
type VenmoPageProps = {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function VenmoInstructionsPage({
  searchParams,
}: VenmoPageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }

  const ownerSub = session.user.id;
  const bib = await getBib(ownerSub);
  if (!bib) {
    // Bootstrap edge case: user reached /sponsor/venmo without going
    // through the landing page bib bootstrap. Send them home so the
    // landing page can idempotently create a bib for them, then they
    // can re-enter the sponsor flow.
    redirect("/orderform");
  }

  const params = (await searchParams) ?? {};
  const amountCents = parseAmountCentsFromQuery(params.amount_cents);
  const handle = await getVenmoHandle();

  // Record the intent so it shows as "in progress" in the runner's
  // transaction history until an organizer reconciles the receipt. Best-effort:
  // a DDB hiccup must never block the payment instructions from rendering.
  await recordPending({
    ownerSub,
    kind: "bib",
    provider: "venmo",
    amountCents,
    runnerCode: bib.runnerCode,
  }).catch((e) =>
    console.warn(`[run.bib] /sponsor/venmo: recordPending failed: ${e}`)
  );

  // Venmo deep-link contract:
  //   venmo://paycharge?txn=pay&recipients=<handle-no-@>&amount=<dollars>&note=<runnerCode>
  // On iOS/Android the app catches the scheme; on desktop the browser
  // shows a "no application to open link" prompt, which is fine — the
  // handle + code are already visible on-page for manual entry.
  const handleForDeepLink = handle.startsWith("@") ? handle.slice(1) : handle;
  const amountDollars = (amountCents / 100).toFixed(2);
  const deepLink =
    `venmo://paycharge?txn=pay` +
    `&recipients=${encodeURIComponent(handleForDeepLink)}` +
    `&amount=${amountDollars}` +
    `&note=${encodeURIComponent(bib.runnerCode)}`;

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
            Sponsor via Venmo
          </h1>
          <p style={{ margin: 0, color: "#a4a4b8", fontSize: 15 }}>
            DEF CON 34 — send the amount below with your runner code in
            the note.
          </p>
        </header>

        <SponsorInstructions
          providerLabel="Venmo"
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
