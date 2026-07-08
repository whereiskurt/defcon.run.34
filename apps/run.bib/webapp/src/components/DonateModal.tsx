"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useCopy } from "@/components/CopyProvider";

/**
 * DonateModal — a self-contained quick-give donate overlay (Kurt
 * 2026-07-05, item #2). Its visible copy is catalog-driven via useCopy()
 * (Phase 37-03) — the title/subhead/labels/CTA resolve from bib.donate.* /
 * bib.checkout.* keys, no longer inline literals.
 *
 * This is the CANONICAL copy. The IDENTICAL file is duplicated into
 * run.human and run.flash (this monorepo duplicates shared header UI per app
 * rather than shipping a shared package). Keep the three copies byte-for-byte
 * in sync — the only per-app difference is the `bibOrigin` / `regionPrefix`
 * the header passes in.
 *
 * Behaviour:
 *   - Renders the same amount picker + provider pills as the bib donate
 *     tile, in a centered modal over a blurred backdrop.
 *   - Card (Stripe): credentialed POST to `${bibOrigin}/api/checkout/general`,
 *     then a full-page redirect to the Stripe Checkout URL. Stripe's
 *     success_url is hard-coded (server-side) to the bib orderform page, so a
 *     completed donation always lands the donor on the Bib & Donation page —
 *     no matter which app opened the modal.
 *   - Venmo / Cash App: navigate to the bib provider page
 *     `${bibOrigin}/${regionPrefix}/sponsor/{venmo,cashapp}?amount_cents=...`
 *     (these are region-prefixed PAGES; the /api/* route is not — bib's nginx
 *     rewrites naked /api/* to /{region}/api/*).
 *
 * URL wiring (2 props, so the same file is same-origin in run.bib and
 * cross-origin elsewhere):
 *   - bibOrigin="" (run.bib, same-origin)  → POST /api/checkout/general
 *   - bibOrigin="https://bib.defcon.run"   → POST https://bib.defcon.run/api/checkout/general (CORS)
 *   - regionPrefix="use1" → provider pages under /use1; "" in dev/no-basePath.
 */

const MIN_CENTS = 1_000; //      $10 donation minimum (matches /api/checkout/general)
const MAX_CENTS = 200_000; //    $2000 ceiling (matches /api/checkout/general)
const SLIDER_MAX_CENTS = 20_000; // $200 slider ceiling (matches the SponsorForm panels)
const SLIDER_STEP_CENTS = 1_000; //  $10 slider steps

type Provider = "stripe" | "cashapp" | "venmo";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; detail: string };

function clampCents(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_CENTS;
  const snapped = Math.floor(raw / 100) * 100;
  return Math.min(MAX_CENTS, Math.max(MIN_CENTS, snapped));
}

function formatUsd(cents: number): string {
  return `$${(clampCents(cents) / 100).toFixed(2)}`;
}

export interface DonateModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Absolute bib origin for cross-app use (e.g. "https://bib.defcon.run").
   * Omit / empty string for same-origin (run.bib itself).
   */
  bibOrigin?: string;
  /**
   * Region prefix for the Venmo / Cash App provider PAGES (e.g. "use1").
   * Empty in dev / when there is no basePath.
   */
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
  // Free-text so typing "55" isn't hijacked by the min-clamp mid-keystroke;
  // the $10 floor is only enforced on blur / submit.
  const [customText, setCustomText] = useState<string>("20");
  const [provider, setProvider] = useState<Provider>("stripe");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Portal target (document.body) is only available client-side; gate on mount.
  useEffect(() => setMounted(true), []);

  const checkoutUrl = `${bibOrigin}/api/checkout/general`;
  const providerBase = regionPrefix ? `${bibOrigin}/${regionPrefix}` : bibOrigin;

  const displayAmount = useMemo(() => formatUsd(amountCents), [amountCents]);
  const disabled = submit.kind === "submitting";

  // Reset transient state whenever the modal is (re)opened, and move focus to
  // the close button for keyboard users.
  useEffect(() => {
    if (open) {
      setSubmit({ kind: "idle" });
      closeRef.current?.focus();
    }
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = clampCents(Number(e.target.value));
      setAmountCents(next);
      setCustomText((next / 100).toString());
    },
    []
  );

  const onCustomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/[^0-9.]/g, "");
      setCustomText(raw);
      const dollars = Number.parseFloat(raw);
      if (!Number.isFinite(dollars)) return;
      setAmountCents(Math.min(MAX_CENTS, Math.max(0, Math.round(dollars * 100))));
    },
    []
  );

  const onCustomBlur = useCallback(() => {
    const clamped = clampCents(amountCents);
    setAmountCents(clamped);
    setCustomText((clamped / 100).toString());
  }, [amountCents]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const cents = clampCents(amountCents);

      if (provider === "venmo" || provider === "cashapp") {
        window.location.href = `${providerBase}/sponsor/${provider}?amount_cents=${cents}`;
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
    },
    [amountCents, provider, providerBase, checkoutUrl]
  );

  if (!open || !mounted) return null;

  // Portal to <body> so the fixed overlay escapes the header's stacking context
  // (the glass-nav's backdrop-filter would otherwise trap it behind the page).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Make a donation"
      onMouseDown={(e) => {
        // Backdrop click (not a click that started inside the panel) closes.
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
          width: "100%",
          maxWidth: 420,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          boxSizing: "border-box",
          padding: 22,
          borderRadius: 16,
          backgroundColor: "#12121a",
          border: "1px solid #24242e",
          color: "#e4e4ef",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            textAlign: "center",
            paddingBottom: 4,
          }}
        >
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
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
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#7a9dff",
            }}
          >
            {t("bib.contribution.kickerSupport")}
          </span>
          <div style={{ color: "#7a9dff" }}>
            <DonateArt />
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
            {t("bib.donate.title")}
          </h2>
          <p style={{ margin: 0, color: "#a4a4b8", fontSize: 13 }}>
            {t("bib.donate.subhead")}
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            marginTop: 18,
          }}
        >
          <div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#8f8fa8",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {t("bib.donate.amountLabel")}
            </span>
            {/* Slider + editable amount box — matches the Sponsor/Donate tile
              * panels (SponsorForm) so the modal reads as the same control. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 10,
              }}
            >
              <input
                type="range"
                min={MIN_CENTS}
                max={SLIDER_MAX_CENTS}
                step={SLIDER_STEP_CENTS}
                value={Math.min(amountCents, SLIDER_MAX_CENTS)}
                onChange={onSliderChange}
                disabled={disabled}
                aria-label="Donation amount"
                style={{
                  flex: 1,
                  minWidth: 0,
                  accentColor: "#6CCDB8",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "8px 12px",
                  backgroundColor: "#1a1a24",
                  border: "1px solid #2a2a34",
                  borderRadius: 8,
                  flex: "0 0 auto",
                  width: 118,
                }}
              >
                <span style={{ color: "#8f8fa8", fontWeight: 700 }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={customText}
                  onChange={onCustomChange}
                  onBlur={onCustomBlur}
                  disabled={disabled}
                  aria-label="Amount in US dollars"
                  style={{
                    width: "100%",
                    minWidth: 0,
                    padding: 0,
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#6CCDB8",
                    backgroundColor: "transparent",
                    border: "none",
                    outline: "none",
                    fontFamily:
                      "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
                  }}
                />
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                color: "#8f8fa8",
                marginTop: 8,
                display: "block",
              }}
            >
              {t("bib.checkout.sliderHelper", {
                min: MIN_CENTS / 100,
                max: MAX_CENTS / 100,
              })}
            </span>
          </div>

          <div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#8f8fa8",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {t("bib.checkout.paymentMethod")}
            </span>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {(
                [
                  ["stripe", t("bib.checkout.providerCard")],
                  ["cashapp", t("bib.checkout.providerCashApp")],
                  ["venmo", t("bib.checkout.providerVenmo")],
                ] as Array<[Provider, string]>
              ).map(([value, label]) => {
                const selected = provider === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setProvider(value)}
                    disabled={disabled}
                    aria-pressed={selected}
                    style={{
                      flex: "1 1 0",
                      minWidth: 0,
                      padding: "8px 10px",
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      backgroundColor: selected ? "#1a1a24" : "transparent",
                      border: `1px solid ${selected ? "#6CCDB8" : "#2a2a34"}`,
                      color: "#e4e4ef",
                      cursor: disabled ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {(provider === "venmo" || provider === "cashapp") && (
              <p style={{ fontSize: 12, color: "#a4a4b8", margin: "8px 0 0" }}>
                {t("bib.checkout.providerNote")}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={disabled}
            style={{
              padding: "13px 20px",
              fontSize: 16,
              fontWeight: 700,
              color: "#0a0a0a",
              backgroundColor: disabled ? "#8f8fa8" : "#6CCDB8",
              border: "none",
              borderRadius: 8,
              cursor: disabled ? "wait" : "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {disabled
              ? t("bib.checkout.redirecting")
              : t("bib.checkout.cta", {
                  label: t("bib.contribution.donateVerb"),
                  amount: displayAmount,
                })}
          </button>

          {submit.kind === "error" && (
            <div role="alert" style={{ fontSize: 13, color: "#ff8a8a" }}>
              {t("bib.checkout.error", { detail: submit.detail })}
            </div>
          )}
        </form>
      </div>
    </div>,
    document.body
  );
}

/** Donate panel art — pixel-coin motif (matches the on-page bib donate tile). */
function DonateArt() {
  return (
    <svg width="72" height="72" viewBox="0 0 88 88" fill="none" aria-hidden="true">
      <circle cx="52" cy="52" r="20" fill="currentColor" fillOpacity="0.15" />
      <circle cx="44" cy="44" r="24" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <circle cx="44" cy="44" r="18" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="4 3" />
      <text x="44" y="52" textAnchor="middle" fontSize="24" fontWeight="900" fill="currentColor" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">$</text>
      <circle cx="20" cy="20" r="2" fill="currentColor" fillOpacity="0.7" />
      <circle cx="72" cy="16" r="1.5" fill="currentColor" fillOpacity="0.5" />
      <circle cx="16" cy="72" r="1.5" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}

export default DonateModal;
