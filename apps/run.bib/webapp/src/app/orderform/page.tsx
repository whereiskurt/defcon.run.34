import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import BibForm from "@/components/BibForm";
import SponsorForm from "@/components/SponsorForm";
import WillPayInPersonCheckbox from "@/components/WillPayInPersonCheckbox";
import { createBib, getBib, type BibItem } from "@/entities/bib";
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
          gap: 40,
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
            Get Your Bib
          </h1>
          <p style={{ margin: 0, color: "#a4a4b8", fontSize: 15 }}>
            defcon.run 34 — run.defcon.run
          </p>
        </header>

        <RunnerCodeBadge code={bib.runnerCode} />

        {status && <StripeStatusBanner status={status} />}

        {/* Section 1: Get your bib (free) */}
        <Section
          title="Get your bib"
          intro="Registration is free. Pick the name that renders on your bib."
        >
          <BibForm
            initialName={bib.nameOnBib || ""}
            nameLocked={bib.nameLocked === true}
            hasSponsored={hasSponsored}
          />
          <div style={{ marginTop: 16 }}>
            <WillPayInPersonCheckbox
              initialValue={bib.willPayInPerson === true}
            />
          </div>
        </Section>

        {/* Section 2: Sponsor this bib */}
        <Section
          title="Sponsor this bib"
          intro="Contributions attach to your bib and help fund defcon.run 34."
        >
          <SponsorForm variant="bib" ctaLabel="Sponsor" />
        </Section>

        {/* Section 3: Just donate */}
        <Section
          title="Just donate"
          intro="Not running? Contribute anyway — support goes directly to defcon.run 34."
        >
          <SponsorForm variant="general" ctaLabel="Donate" />
        </Section>

        <FooterNote />
      </div>
    </main>
  );
}

/**
 * Section wrapper — visual container for each of the three landing-page
 * blocks. Server component (no client JS) so it stays fast to render.
 */
function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
      aria-label={title}
    >
      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          margin: 0,
          letterSpacing: "0.01em",
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
        }}
      >
        {intro}
      </p>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
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

/**
 * Small badge that surfaces the runnerCode above the form. The code is
 * immutable per user and used by the Phase 22 payment reconciliation
 * Lambda to match Venmo / CashApp receipts back to a bib.
 */
function RunnerCodeBadge({ code }: { code: string }) {
  return (
    <div
      role="group"
      aria-label="Your runner code"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        alignSelf: "flex-start",
        padding: "10px 18px",
        borderRadius: 999,
        backgroundColor: "#1a1a24",
        border: "1px solid #2a2a34",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#8f8fa8",
        }}
      >
        Runner code
      </span>
      <span
        style={{
          fontFamily:
            "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
          fontSize: 18,
          fontWeight: 700,
          color: "#f4b942",
          letterSpacing: "0.05em",
        }}
      >
        {code}
      </span>
    </div>
  );
}

/**
 * Static footer note explaining the shape of the flow: name edits save on
 * their own; payment reconciliation is a Phase 22 concern.
 */
function FooterNote() {
  return (
    <p
      style={{
        margin: "16px 0 0",
        fontSize: 13,
        color: "#8f8fa8",
        lineHeight: 1.6,
      }}
    >
      Your name saves automatically as you type. Include your runner code in
      the Venmo or Cash App comment when you pay so we can match your
      payment to this bib.
    </p>
  );
}
