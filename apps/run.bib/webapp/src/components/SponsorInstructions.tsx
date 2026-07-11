import type { ReactNode } from "react";
import QRCode from "qrcode";
import { formatCentsUsd } from "@/lib/amount";
import { loadCopy, t } from "@/lib/copy";
import PayLinkPanel, { type PayVariant } from "@/components/PayLinkPanel";

const QR_OPTS = {
  margin: 1,
  width: 240,
  errorCorrectionLevel: "M" as const,
  color: { dark: "#0a0a0aff", light: "#ffffffff" },
};

/** Label the scheme of a pay URL for the toggle ("venmo://" / "https://"). */
function schemeLabel(url: string): string {
  const scheme = url.slice(0, url.indexOf(":") + 1);
  return scheme === "https:" ? "https://" : scheme + "//";
}

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
   * Optional HTTPS equivalent of `deepLink` (e.g.
   * `https://venmo.com/?txn=pay&...`). When present, the pay panel gains a
   * slick toggle that swaps the QR + URL + button between the native scheme
   * (`deepLink`, shown first) and this web link.
   */
  httpsDeepLink?: string;
  /**
   * Optional accent color for the amount + handle typography. Defaults
   * to the DEF CON green (DC34 mint palette #6CCDB8) (#6CCDB8) shared with SponsorForm.
   */
  accentColor?: string;
  /**
   * Optional post-content slot for provider-specific fine print (e.g.,
   * "Comments are private on Venmo — set privacy to Friends if you
   * want that").
   */
  footer?: ReactNode;
}

export async function SponsorInstructions({
  providerLabel,
  handle,
  runnerCode,
  amountCents,
  deepLink,
  httpsDeepLink,
  accentColor = "#6CCDB8",
  footer,
}: SponsorInstructionsProps) {
  const amountDisplay = formatCentsUsd(amountCents);
  const copy = await loadCopy("default");

  // Build the pay-link variants (native scheme first, optional HTTPS second)
  // and pre-render each QR to a PNG data URI on the server — the client panel
  // just swaps between them, so no client-side QR generation. Encoding the same
  // URL the button uses means scanning == tapping "Open <provider>".
  const linkUrls = [deepLink, httpsDeepLink].filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
  const payVariants: PayVariant[] = await Promise.all(
    linkUrls.map(async (url) => ({
      key: schemeLabel(url),
      schemeLabel: schemeLabel(url),
      url,
      qr: await QRCode.toDataURL(url, QR_OPTS),
    }))
  );
  const openLabel = t(copy, "bib.instructions.openProvider", {
    provider: providerLabel,
  });

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
          {t(copy, "bib.instructions.payVia", { provider: providerLabel })}
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

      {(() => {
        const infoRows = (
          <>
            <InstructionRow
              label={t(copy, "bib.instructions.sendTo")}
              value={handle}
              accentColor={accentColor}
            />
            <InstructionRow
              label={t(copy, "bib.instructions.requiredComment")}
              value={runnerCode}
              accentColor={accentColor}
              hint={t(copy, "bib.instructions.requiredCommentHint")}
            />
          </>
        );
        // With pay links, PayLinkPanel owns the layout (info rows left, QR +
        // toggle beside, actions full-width below). Without, just the rows.
        return payVariants.length > 0 ? (
          <PayLinkPanel
            variants={payVariants}
            providerLabel={providerLabel}
            runnerCode={runnerCode}
            amountDisplay={amountDisplay}
            accentColor={accentColor}
            openLabel={openLabel}
            infoRows={infoRows}
          />
        ) : (
          infoRows
        );
      })()}

      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "#8f8fa8",
          lineHeight: 1.6,
        }}
      >
        {t(copy, "bib.instructions.reconcileNoteBefore")}
        <code>{runnerCode}</code>
        {t(copy, "bib.instructions.reconcileNoteAfter")}
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
