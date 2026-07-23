"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DonateCard } from "./DonateCard";

/**
 * DonateModal — the quick-give donate overlay. As of 2026-07-11 (Kurt) the
 * inner control set is the shared DonateCard (Riff C: big ±$5 stepper + doubled
 * Pay button); this file owns only the modal chrome (portal + backdrop + close)
 * and the checkout wiring.
 *
 * This is the run.human / run.flash copy: identical to run.bib's DonateModal
 * EXCEPT the copy strings are inline literals (these apps don't mount the bib
 * CopyProvider). Keep the DonateCard usage in sync with run.bib.
 *
 * Checkout (unchanged):
 *   - Card (Stripe): credentialed cross-origin POST to
 *     `${bibOrigin}/api/checkout/general`, then a full-page redirect to Stripe.
 *   - Venmo: navigate to `${bibOrigin}/${regionPrefix}/sponsor/venmo?amount_cents=...`.
 */

const MIN_CENTS = 1_000; //   $10 donation minimum (matches /api/checkout/general)
const MAX_CENTS = 200_000; // $2000 ceiling (matches /api/checkout/general)

type Provider = "stripe" | "venmo";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; detail: string };

function clampCents(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_CENTS;
  const snapped = Math.floor(raw / 100) * 100;
  return Math.min(MAX_CENTS, Math.max(MIN_CENTS, snapped));
}

export interface DonateModalProps {
  open: boolean;
  onClose: () => void;
  /** Absolute bib origin for cross-app use (e.g. "https://bib.defcon.run"). */
  bibOrigin?: string;
  /** Region prefix for the Venmo provider PAGE (e.g. "use1"). */
  regionPrefix?: string;
}

export function DonateModal({
  open,
  onClose,
  bibOrigin = "",
  regionPrefix = "",
}: DonateModalProps) {
  const [amountCents, setAmountCents] = useState<number>(2_000); // $20 default
  const [provider, setProvider] = useState<Provider>("stripe");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  const checkoutUrl = `${bibOrigin}/api/checkout/general`;
  const providerBase = regionPrefix ? `${bibOrigin}/${regionPrefix}` : bibOrigin;

  useEffect(() => {
    if (open) {
      setSubmit({ kind: "idle" });
      closeRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const runCheckout = useCallback(async () => {
    const cents = clampCents(amountCents);

    if (provider === "venmo") {
      window.location.href = `${providerBase}/sponsor/venmo?amount_cents=${cents}`;
      return;
    }

    setSubmit({ kind: "submitting" });
    try {
      const res = await fetch(checkoutUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Cross-subdomain (.defcon.run) session cookie must ride along.
        credentials: "include",
        body: JSON.stringify({ amount_cents: cents }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          // No bib session (sess_bib is .defcon.run-scoped but only lives
          // 24h and is only minted on bib itself). Bounce through a bib
          // PAGE instead of erroring: bib's full-app auth gate + SSO sign
          // the user in without a prompt, and the orderform carries this
          // same donate tile, so the donation completes there.
          window.location.href = `${providerBase}/orderform`;
          return;
        }
        setSubmit({ kind: "error", detail: `HTTP ${res.status}` });
        return;
      }
      const body = (await res.json()) as { session_url?: string };
      if (!body.session_url) {
        setSubmit({ kind: "error", detail: "missing session_url" });
        return;
      }
      window.location.href = body.session_url;
    } catch (err) {
      setSubmit({
        kind: "error",
        detail: err instanceof Error ? err.message : "network",
      });
    }
  }, [amountCents, provider, providerBase, checkoutUrl]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Make a donation"
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
          maxWidth: 440,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
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
        <DonateCard
          amountCents={amountCents}
          minCents={MIN_CENTS}
          maxCents={MAX_CENTS}
          onAmount={setAmountCents}
          provider={provider}
          onProvider={setProvider}
          offerVenmo
          submitting={submit.kind === "submitting"}
          error={
            submit.kind === "error"
              ? `Could not start checkout (${submit.detail}) - try again.`
              : null
          }
          onSubmit={runCheckout}
          copy={{
            kicker: "Support",
            supportLabel: "Your support",
            title: "Just donate",
            subhead: "Support goes directly to defcon.run 34. Thank you!",
            stepHint: "$5 steps",
            payWith: "Payment method",
            card: "Card",
            venmo: "Venmo",
            venmoNote:
              "Venmo contributions are confirmed by an organizer - your contribution appears once approved.",
            runnerLabel: "Runner",
            copyLabel: "Copy",
            copiedLabel: "Copied",
            payNow: "Donate",
            payShort: "Donate",
            roundUp: "round up +$5",
            redirecting: "Redirecting…",
          }}
        />
      </div>
    </div>,
    document.body
  );
}

export default DonateModal;
