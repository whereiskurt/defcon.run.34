"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useCopy } from "@/components/CopyProvider";
import { DonateCard } from "./DonateCard";

/**
 * DonateModal — the quick-give donate overlay. As of 2026-07-11 (Kurt) the
 * inner control set is the shared DonateCard (Riff C: big ±$5 stepper + doubled
 * Pay button); this file owns only the modal chrome (portal + backdrop + close)
 * and the checkout wiring.
 *
 * This is the CANONICAL copy. The near-identical file is duplicated into
 * run.human and run.flash (this monorepo duplicates shared header UI per app
 * rather than shipping a package). The only per-app differences are (a) the
 * `bibOrigin`/`regionPrefix` the header passes in and (b) run.bib resolves copy
 * via useCopy() while run.human/run.flash pass literal strings (they don't mount
 * the CopyProvider). Keep the DonateCard usage in sync.
 *
 * Checkout (unchanged):
 *   - Card (Stripe): credentialed POST to `${bibOrigin}/api/checkout/general`,
 *     then a full-page redirect to the Stripe Checkout URL.
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
  const { t } = useCopy();
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
              ? t("bib.checkout.error", { detail: submit.detail })
              : null
          }
          onSubmit={runCheckout}
          copy={{
            kicker: t("bib.contribution.kickerSupport"),
            supportLabel: "Your support",
            title: t("bib.donate.title"),
            subhead: t("bib.donate.subhead"),
            stepHint: "$5 steps",
            payWith: t("bib.checkout.paymentMethod"),
            card: t("bib.checkout.providerCard"),
            venmo: t("bib.checkout.providerVenmo"),
            venmoNote: t("bib.checkout.providerNote"),
            runnerLabel: "Runner",
            copyLabel: "Copy",
            copiedLabel: "Copied",
            payNow: t("bib.contribution.donateVerb"),
            payShort: t("bib.contribution.donateVerb"),
            roundUp: "round up +$5",
            redirecting: t("bib.checkout.redirecting"),
          }}
        />
      </div>
    </div>,
    document.body
  );
}

export default DonateModal;
