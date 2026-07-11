"use client";

import { useState } from "react";

/**
 * PayLinkPanel — client-side pay-link switcher for the sponsor pages.
 *
 * Shows a scannable QR + the raw pay URL + an "Open" button, all driven by the
 * currently-selected variant. When more than one variant is supplied (Venmo:
 * `venmo://` native vs `https://` web), a slick segmented toggle swaps the QR,
 * the URL text, and the button href together. Defaults to the FIRST variant
 * (native `venmo://`), per Kurt's spec.
 *
 * QRs are pre-rendered to PNG data URIs on the server (no client-side QR gen);
 * this component just swaps between them, so the switch is instant.
 */
export interface PayVariant {
  /** Stable key + accessible label, e.g. "venmo://" / "https://". */
  key: string;
  schemeLabel: string;
  /** The pay URL for this variant. */
  url: string;
  /** Pre-rendered QR PNG data URI encoding `url`. */
  qr: string;
}

export interface PayLinkPanelProps {
  variants: PayVariant[];
  providerLabel: string;
  runnerCode: string;
  amountDisplay: string;
  accentColor: string;
  openLabel: string;
}

export default function PayLinkPanel({
  variants,
  providerLabel,
  runnerCode,
  amountDisplay,
  accentColor,
  openLabel,
}: PayLinkPanelProps) {
  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const active = variants[idx] ?? variants[0];
  const hasToggle = variants.length > 1;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the URL is visible for manual copy */
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}
    >
      {hasToggle && (
        <div
          role="tablist"
          aria-label={`${providerLabel} link type`}
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            backgroundColor: "#1a1a24",
            border: "1px solid #2a2a34",
            borderRadius: 999,
          }}
        >
          {variants.map((v, i) => {
            const selected = i === idx;
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setIdx(i)}
                style={{
                  padding: "7px 18px",
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  fontFamily:
                    "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
                  backgroundColor: selected ? accentColor : "transparent",
                  color: selected ? "#0a0a0a" : "#a4a4b8",
                  transition:
                    "background-color 140ms ease, color 140ms ease",
                }}
              >
                {v.schemeLabel}
              </button>
            );
          })}
        </div>
      )}

      <div
        style={{
          backgroundColor: "#ffffff",
          padding: 12,
          borderRadius: 12,
          lineHeight: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={active.key}
          src={active.qr}
          alt={`Scan to pay ${amountDisplay} to ${providerLabel} — note ${runnerCode}`}
          width={200}
          height={200}
          style={{ display: "block", width: 200, height: 200 }}
        />
      </div>

      <span
        style={{
          fontSize: 13,
          color: "#a4a4b8",
          textAlign: "center",
          maxWidth: 340,
          lineHeight: 1.5,
        }}
      >
        On a computer? Scan with your phone to open {providerLabel} with the
        amount and <code>{runnerCode}</code> note prefilled.
      </span>

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 8,
          width: "100%",
          maxWidth: 440,
        }}
      >
        <code
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            backgroundColor: "#1a1a24",
            border: "1px solid #2a2a34",
            borderRadius: 6,
            fontSize: 12,
            color: "#a4a4b8",
            wordBreak: "break-all",
            lineHeight: 1.4,
          }}
        >
          {active.url}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy pay link"
          style={{
            flexShrink: 0,
            padding: "0 14px",
            fontSize: 13,
            fontWeight: 700,
            color: "#e4e4ef",
            backgroundColor: "#2a2a34",
            border: "1px solid #3a3a44",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <a
        href={active.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          textAlign: "center",
          width: "100%",
          maxWidth: 440,
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
        {openLabel}
      </a>
    </div>
  );
}
