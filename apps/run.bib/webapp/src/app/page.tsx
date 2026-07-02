import { redirect } from "next/navigation";

import { auth } from "@/config/auth";
import BibForm from "@/components/BibForm";
import { createBib, getBib, type BibItem } from "@/entities/bib";
import { generateUniqueRunnerCode } from "@/lib/runner-code";

/**
 * Landing page for run.bib.
 *
 * Server component. Middleware already redirected unauthenticated requests
 * to /signin, but we call auth() here as a belt-and-suspenders check so
 * TypeScript sees a non-null session before we key on session.user.id.
 *
 * Bib bootstrap flow (matches PLAN.md 21-03-03):
 *   1. auth() — verify session, else redirect.
 *   2. getBib(ownerSub) — server-side entity read (skips a self-fetch on
 *      /api/bib because we're inside the same Next.js runtime and can talk
 *      to ElectroDB directly).
 *   3. If no bib yet: generateUniqueRunnerCode() + createBib(ownerSub, code)
 *      — server-side idempotent create.
 *   4. Render the shell + BIB-XXXX badge + <BibForm>.
 *
 * `createBib` is idempotent under ConditionalCheckFailedException, so even
 * if two concurrent tabs POST at the same time only one code wins and both
 * end up reading the same bib.
 */
export default async function Home() {
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
            Get Your Bib
          </h1>
          <p style={{ margin: 0, color: "#a4a4b8", fontSize: 15 }}>
            DEF CON 34 — run.defcon.run
          </p>
        </header>

        <RunnerCodeBadge code={bib.runnerCode} />

        <BibForm
          initialName={bib.nameOnBib || ""}
          initialCode={bib.runnerCode}
          nameLocked={bib.nameLocked === true}
        />

        <FooterNote />
      </div>
    </main>
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
