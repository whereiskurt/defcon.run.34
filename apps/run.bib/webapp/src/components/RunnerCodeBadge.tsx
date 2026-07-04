"use client";

import { useState } from "react";

/**
 * Runner-code pill with a copy button (Kurt 2026-07-03). Sits right above the
 * Sponsor / Donate CTA so runners copy their code into the Venmo / Cash App
 * comment — the code (BIB-XXXX) is how those payments reconcile back to a bib.
 */
export function RunnerCodeBadge({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op; the code stays visible to type manually.
    }
  };

  return (
    <div
      role="group"
      aria-label="Your runner code"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 10,
        backgroundColor: "#1a1a24",
        border: "1px solid #2a2a34",
      }}
    >
      <span
        style={{
          fontSize: 11,
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
          color: "#6CCDB8",
          letterSpacing: "0.05em",
          flex: 1,
        }}
      >
        {code}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy runner code"
        style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 700,
          color: copied ? "#0a0a0a" : "#e4e4ef",
          backgroundColor: copied ? "#6CCDB8" : "#2a2a34",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

export default RunnerCodeBadge;
