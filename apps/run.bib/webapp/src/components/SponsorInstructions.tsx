import type { ReactNode } from "react";
import { formatCentsUsd } from "@/lib/amount";

/**
 * SponsorInstructions
 *
 * Server-rendered payment-instructions display shared by the Venmo
 * (`/sponsor/venmo`) and Cash App (`/sponsor/cashapp`) pages. Pure
 * presentational — no interactivity, no client bundle.
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-02 + prompt spec):
 * - Prominent handle (Venmo `@defconrun` or Cash App `$defconrun`).
 * - Prominent BIB-XXXX runner code as the REQUIRED comment/note — this
 *   is the load-bearing hook the reconciliation Lambda (Plan 22-04)
 *   uses to match receipts back to bibs.
 * - Amount in $XX.XX (already clamped by the caller via
 *   clampAmountCents; the caller also decides how to format via
 *   formatCentsUsd for consistency with SponsorForm).
 * - Deep-link `<a>` uses the caller-provided URL scheme (`venmo://` or
 *   `cashapp://`). External `target="_blank"` opens the mobile app on
 *   iOS/Android where installed; on desktop the deep-link silently
 *   fails and the user copies the handle manually.
 * - Login gate: caller (the page) is behind full-app middleware.
 */
export interface SponsorInstructionsProps {
  /** Human-readable provider name (e.g., "Venmo", "Cash App"). */
  providerLabel: string;
  /** Handle to send the payment to (e.g., "@defconrun"). */
  handle: string;
  /** BIB-XXXX runner code — MUST appear verbatim in the payment note. */
  runnerCode: string;
  /** Payment amount in cents (already clamped by caller). */
  amountCents: number;
  /**
   * Optional deep-link URL (e.g.,
   * `venmo://paycharge?txn=pay&recipients=defconrun&amount=25&note=BIB-1234`).
   * Rendered as a big call-to-action; omitted if undefined.
   */
  deepLink?: string;
  /**
   * Optional accent color for the amount + handle typography. Defaults
   * to the DEF CON amber (#f4b942) shared with SponsorForm.
   */
  accentColor?: string;
  /**
   * Optional post-content slot for provider-specific fine print (e.g.,
   * "Comments are private on Venmo — set privacy to Friends if you
   * want that").
   */
  footer?: ReactNode;
}

export function SponsorInstructions({
  providerLabel,
  handle,
  runnerCode,
  amountCents,
  deepLink,
  accentColor = "#f4b942",
  footer,
}: SponsorInstructionsProps) {
  const amountDisplay = formatCentsUsd(amountCents);

  return (
    <section
      aria-label={`${providerLabel} payment instructions`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "24px",
        backgroundColor: "#12121a",
        border: "1px solid #2a2a34",
        borderRadius: 10,
        width: "100%",
        maxWidth: 720,
        margin: "24px auto 0",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#8f8fa8",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Pay via {providerLabel}
        </span>
        <div
          style={{
            fontSize: 40,
            fontWeight: 800,
            color: accentColor,
            fontFamily:
              "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
            letterSpacing: "0.02em",
            lineHeight: 1.1,
          }}
        >
          {amountDisplay}
        </div>
      </header>

      <InstructionRow
        label="Send to"
        value={handle}
        accentColor={accentColor}
      />

      <InstructionRow
        label="Required comment"
        value={runnerCode}
        accentColor={accentColor}
        hint="This BIB-XXXX code must be in the payment note so we can match your sponsorship to your bib."
      />

      {deepLink && (
        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            textAlign: "center",
            padding: "14px 20px",
            fontSize: 16,
            fontWeight: 700,
            color: "#0a0a0a",
            backgroundColor: accentColor,
            border: "none",
            borderRadius: 6,
            textDecoration: "none",
            letterSpacing: "0.02em",
          }}
        >
          Open {providerLabel}
        </a>
      )}

      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "#8f8fa8",
          lineHeight: 1.6,
        }}
      >
        After you send the payment, come back here — reconciliation is
        automatic and usually finishes within a few minutes. Payments
        without <code>{runnerCode}</code> in the note are flagged for
        manual review.
      </p>

      {footer}
    </section>
  );
}

function InstructionRow({
  label,
  value,
  accentColor,
  hint,
}: {
  label: string;
  value: string;
  accentColor: string;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#8f8fa8",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div
        style={{
          padding: "12px 16px",
          borderRadius: 6,
          backgroundColor: "#1a1a24",
          border: "1px solid #2a2a34",
          fontFamily:
            "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
          fontSize: 22,
          fontWeight: 700,
          color: accentColor,
          letterSpacing: "0.03em",
          wordBreak: "break-all",
        }}
      >
        {value}
      </div>
      {hint && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "#a4a4b8",
            lineHeight: 1.5,
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export default SponsorInstructions;
