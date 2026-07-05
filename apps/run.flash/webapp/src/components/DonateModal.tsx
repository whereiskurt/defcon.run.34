"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * DonateModal — a self-contained "Just donate" quick-give overlay (Kurt
 * 2026-07-05, item #2).
 *
 * This is the CANONICAL copy. The IDENTICAL file is duplicated into
 * run.human and run.flash (this monorepo duplicates shared header UI per app
 * rather than shipping a shared package). Keep the three copies byte-for-byte
 * in sync — the only per-app difference is the `bibOrigin` / `regionPrefix`
 * the header passes in.
 *
 * Behaviour:
 *   - Renders the same amount picker + provider pills as the bib "Just donate"
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

const MIN_CENTS = 1_000; //   $10 donation minimum (matches /api/checkout/general)
const MAX_CENTS = 200_000; // $2000 ceiling (matches /api/checkout/general)
const PRESETS_DOLLARS = [5, 10, 15, 20, 25, 40, 50, 75, 100, 200, 250] as const;

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

  const pickPreset = useCallback((dollars: number) => {
    const cents = clampCents(dollars * 100);
    setAmountCents(cents);
    setCustomText((cents / 100).toString());
  }, []);

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
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              Just donate
            </h2>
            <p style={{ margin: "4px 0 0", color: "#a4a4b8", fontSize: 13 }}>
              Support goes directly to defcon.run 34. Thank you!
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flex: "0 0 auto",
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
              Donation amount
            </span>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 10,
              }}
            >
              {PRESETS_DOLLARS.map((d) => {
                const selected = amountCents === clampCents(d * 100);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => pickPreset(d)}
                    disabled={disabled}
                    aria-pressed={selected}
                    style={{
                      padding: "7px 12px",
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 700,
                      backgroundColor: selected ? "#1a1a24" : "transparent",
                      border: `1px solid ${selected ? "#6CCDB8" : "#2a2a34"}`,
                      color: selected ? "#6CCDB8" : "#e4e4ef",
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    ${d}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 12,
                padding: "8px 12px",
                backgroundColor: "#1a1a24",
                border: "1px solid #2a2a34",
                borderRadius: 8,
                width: 140,
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
              Payment method
            </span>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {(
                [
                  ["stripe", "Card"],
                  ["cashapp", "Cash App"],
                  ["venmo", "Venmo"],
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
                Venmo &amp; Cash App are confirmed by an organizer — your
                contribution appears once approved.
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
            {disabled ? "Redirecting…" : `Donate ${displayAmount}`}
          </button>

          {submit.kind === "error" && (
            <div role="alert" style={{ fontSize: 13, color: "#ff8a8a" }}>
              Could not start checkout ({submit.detail}) — try again.
            </div>
          )}
        </form>
      </div>
    </div>,
    document.body
  );
}

export default DonateModal;
