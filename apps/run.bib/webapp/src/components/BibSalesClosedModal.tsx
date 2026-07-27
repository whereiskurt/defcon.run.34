"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dumpsterFire from "@public/dumpster-fire.gif";

/**
 * BibSalesClosedModal (Kurt 2026-07-26: "We're done selling bibs").
 *
 * The gag that replaces bib checkout once sales close (lib/bib-sales.ts).
 * SponsorForm opens this after a fake "redirecting…" beat: the dumpster-fire
 * GIF (same static-import asset BurningBib uses), "Where were you!??", and a
 * Donate Instead CTA that routes to /donate (relative — useRouter layers the
 * /use1 basePath). Modal chrome mirrors DonateModal (portal + backdrop +
 * Escape + ✕) with the same hard-coded dark palette.
 */
export interface BibSalesClosedModalProps {
  open: boolean;
  onClose: () => void;
}

export function BibSalesClosedModal({ open, onClose }: BibSalesClosedModalProps) {
  const router = useRouter();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bib sales closed"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backgroundColor: "rgba(4,4,8,0.72)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          borderRadius: 14,
          border: "1px solid #2a2a34",
          backgroundColor: "#12121a",
          padding: "28px 22px 24px",
          textAlign: "center",
        }}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 2,
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1px solid #2a2a34",
            backgroundColor: "#1a1a24",
            color: "#e4e4ef",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
        {/* Plain <img> (not next/image) so the GIF animation is preserved —
            same rationale as BurningBib. */}
        <img
          src={dumpsterFire.src}
          alt="A dumpster on fire"
          width={dumpsterFire.width}
          height={dumpsterFire.height}
          style={{
            width: "min(240px, 70%)",
            height: "auto",
            margin: "0 auto 14px",
            display: "block",
            borderRadius: 10,
          }}
        />
        <h2
          style={{
            margin: "0 0 8px",
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "0.01em",
            color: "#e4e4ef",
          }}
        >
          Bib sales closed. Where were you!??
        </h2>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "#a0a0b2",
          }}
        >
          The bib train has left the station. Make it up to us by donating —
          every dollar still covers swag and the morning meetups.
        </p>
        <button
          type="button"
          onClick={() => router.push("/donate")}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid #7a9dff",
            backgroundColor: "#7a9dff",
            color: "#0b0b12",
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: "0.02em",
            cursor: "pointer",
          }}
        >
          Donate Instead
        </button>
      </div>
    </div>,
    document.body
  );
}

export default BibSalesClosedModal;
