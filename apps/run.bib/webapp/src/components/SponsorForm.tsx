"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * SponsorForm
 *
 * Client-side custom-amount + provider CTA rendered inside a landing-page
 * section. Owns the slider ($1..$1000 in $1 steps) and the provider
 * picker (Stripe | Venmo | CashApp). Phase 22-05 §22-05-04 introduces a
 * `variant` prop so the same component can back both the "Sponsor this
 * bib" section (POSTs /api/checkout/bib) and the "Just donate" section
 * (POSTs /api/checkout/general).
 *
 * On submit:
 *   - `stripe`   → POST /api/checkout/${variant}, redirect to Stripe URL.
 *   - `venmo`    → route to /sponsor/venmo?amount_cents=... (Plan 22-02).
 *                  Only offered when variant='bib' — general Venmo /
 *                  CashApp donations are v1.6.
 *   - `cashapp`  → route to /sponsor/cashapp?amount_cents=... (same v1.5 gate).
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-01-02, extended by 22-05-04):
 * - Slider is a raw <input type="range" min={100} max={100000} step={100}>.
 * - Provider radio: Stripe default.
 *   - variant='bib' offers Stripe + Venmo + CashApp (unchanged from 22-01).
 *   - variant='general' offers Stripe only for MVP.
 * - Amount display: `$XX.XX` (cents → dollars, 2dp).
 * - Login gate: this component renders inside the landing page which is
 *   behind full-app auth middleware. No client-side auth check.
 */

export const AMOUNT_MIN_CENTS = 100; //   $1.00
export const AMOUNT_MAX_CENTS = 100_000; // $1000.00
export const AMOUNT_STEP_CENTS = 100; //   $1.00 steps

export type SponsorProvider = "stripe" | "venmo" | "cashapp";

/**
 * Two-product variant discriminator (Phase 22-05).
 *
 * - "bib": posts to /api/checkout/bib. Full Venmo + CashApp handoff enabled.
 * - "general": posts to /api/checkout/general. Stripe-only for MVP.
 */
export type SponsorVariant = "bib" | "general";

/**
 * Clamp an amount (cents) into the design-contract range, snapping to
 * the step boundary. Extracted as a pure function so vitest can pin the
 * boundary behavior without booting jsdom.
 *
 * - NaN / non-finite → AMOUNT_MIN_CENTS (fail-safe minimum, never $0).
 * - Values below MIN clamp to MIN.
 * - Values above MAX clamp to MAX.
 * - Fractional cents round DOWN to the nearest step (e.g. 4999 → 4900).
 *   This matches the Stripe Checkout expected shape (whole cents only).
 */
export function clampAmountCents(raw: number): number {
  if (!Number.isFinite(raw)) return AMOUNT_MIN_CENTS;
  const snapped = Math.floor(raw / AMOUNT_STEP_CENTS) * AMOUNT_STEP_CENTS;
  if (snapped < AMOUNT_MIN_CENTS) return AMOUNT_MIN_CENTS;
  if (snapped > AMOUNT_MAX_CENTS) return AMOUNT_MAX_CENTS;
  return snapped;
}

/**
 * Format cents to a display string like `$12.34`. Pure, exported so
 * tests can pin the format.
 */
export function formatCentsUsd(cents: number): string {
  const clamped = clampAmountCents(cents);
  const dollars = clamped / 100;
  return `$${dollars.toFixed(2)}`;
}

/**
 * Resolve the client-side handoff URL for a non-Stripe provider.
 * Applies only to variant='bib' — the general donation flow is Stripe-only.
 */
export function providerRouteFor(
  provider: Exclude<SponsorProvider, "stripe">,
  amountCents: number
): string {
  const clamped = clampAmountCents(amountCents);
  const path = provider === "venmo" ? "/sponsor/venmo" : "/sponsor/cashapp";
  return `${path}?amount_cents=${clamped}`;
}

/**
 * Resolve the Stripe checkout endpoint for a given SponsorVariant.
 * Single source of truth for the /api/checkout/{bib,general} route strings.
 */
export function checkoutEndpointFor(variant: SponsorVariant): string {
  return variant === "bib" ? "/api/checkout/bib" : "/api/checkout/general";
}

interface SubmitState {
  kind: "idle" | "submitting" | "error";
  detail?: string;
}

export interface SponsorFormProps {
  /**
   * Two-product discriminator (Phase 22-05). Defaults to 'bib' so
   * pre-22-05 callers keep working without a diff.
   */
  variant?: SponsorVariant;
  /**
   * Submit button label. Defaults to "Sponsor" for variant='bib' and
   * "Donate" for variant='general'.
   */
  ctaLabel?: string;
  /**
   * Default slider value (cents). Defaults to 2000 ($20).
   */
  defaultAmountCents?: number;
}

export function SponsorForm({
  variant = "bib",
  ctaLabel,
  defaultAmountCents = 2000,
}: SponsorFormProps = {}) {
  const router = useRouter();

  const [amountCents, setAmountCents] = useState<number>(
    clampAmountCents(defaultAmountCents)
  );
  const [provider, setProvider] = useState<SponsorProvider>("stripe");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  const displayAmount = useMemo(
    () => formatCentsUsd(amountCents),
    [amountCents]
  );

  // Venmo / CashApp only offered for variant='bib'. The v1.5 Haiku
  // matcher assumes runnerCode-in-comment lookups; general donations via
  // Venmo/CashApp with no runnerCode + no sender-in-bibs match would hit
  // 'unmatched'. Working as intended per PLAN-22-05.md design gap #2.
  const offerNonStripe = variant === "bib";

  const onSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(event.target.value, 10);
      setAmountCents(clampAmountCents(parsed));
    },
    []
  );

  const onProviderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value as SponsorProvider;
      if (next === "stripe" || next === "venmo" || next === "cashapp") {
        setProvider(next);
      }
    },
    []
  );

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const clamped = clampAmountCents(amountCents);

      // Non-Stripe: route to the provider instructions page (Plan 22-02).
      if (provider === "venmo" || provider === "cashapp") {
        if (!offerNonStripe) {
          // Defensive — the radio is hidden for variant='general' but
          // guard here in case a caller wires the state externally.
          setSubmit({
            kind: "error",
            detail: "unavailable for general donations",
          });
          return;
        }
        setSubmit({ kind: "idle" });
        router.push(providerRouteFor(provider, clamped));
        return;
      }

      // Stripe: POST /api/checkout/${variant}, then redirect.
      setSubmit({ kind: "submitting" });
      try {
        const res = await fetch(checkoutEndpointFor(variant), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount_cents: clamped, provider: "stripe" }),
        });

        if (!res.ok) {
          const detail = `HTTP ${res.status}`;
          setSubmit({ kind: "error", detail });
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
    [amountCents, provider, offerNonStripe, variant]
  );

  const disabled = submit.kind === "submitting";
  const resolvedCtaLabel = ctaLabel ?? (variant === "bib" ? "Sponsor" : "Donate");

  return (
    <form
      onSubmit={onSubmit}
      aria-label={
        variant === "bib" ? "Sponsor a bib" : "Make a general donation"
      }
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
        margin: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#8f8fa8",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {variant === "bib" ? "Sponsor amount" : "Donation amount"}
        </span>
        <div
          style={{
            fontSize: 40,
            fontWeight: 800,
            color: "#f4b942",
            fontFamily:
              "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
            letterSpacing: "0.02em",
            lineHeight: 1.1,
          }}
          aria-live="polite"
        >
          {displayAmount}
        </div>
      </div>

      <label
        htmlFor={`sponsor-amount-slider-${variant}`}
        style={{
          fontSize: 13,
          color: "#a4a4b8",
        }}
      >
        Drag to choose an amount ($1 to $1000)
      </label>
      <input
        id={`sponsor-amount-slider-${variant}`}
        type="range"
        min={AMOUNT_MIN_CENTS}
        max={AMOUNT_MAX_CENTS}
        step={AMOUNT_STEP_CENTS}
        value={amountCents}
        onChange={onSliderChange}
        disabled={disabled}
        aria-valuemin={AMOUNT_MIN_CENTS}
        aria-valuemax={AMOUNT_MAX_CENTS}
        aria-valuenow={amountCents}
        aria-valuetext={displayAmount}
        style={{ width: "100%" }}
      />

      {offerNonStripe && (
        <fieldset
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            border: "none",
            padding: 0,
            margin: 0,
          }}
        >
          <legend
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#8f8fa8",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: 0,
            }}
          >
            Payment method
          </legend>
          <ProviderRadio
            value="stripe"
            label="Stripe (card)"
            selected={provider}
            onChange={onProviderChange}
            disabled={disabled}
            variant={variant}
          />
          <ProviderRadio
            value="venmo"
            label="Venmo"
            selected={provider}
            onChange={onProviderChange}
            disabled={disabled}
            variant={variant}
          />
          <ProviderRadio
            value="cashapp"
            label="Cash App"
            selected={provider}
            onChange={onProviderChange}
            disabled={disabled}
            variant={variant}
          />
        </fieldset>
      )}

      <button
        type="submit"
        disabled={disabled}
        style={{
          padding: "14px 20px",
          fontSize: 16,
          fontWeight: 700,
          color: "#0a0a0a",
          backgroundColor: disabled ? "#8f8fa8" : "#f4b942",
          border: "none",
          borderRadius: 6,
          cursor: disabled ? "wait" : "pointer",
          letterSpacing: "0.02em",
        }}
      >
        {disabled
          ? "Redirecting…"
          : `${resolvedCtaLabel} ${displayAmount}`}
      </button>

      {submit.kind === "error" && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: "#ff8a8a",
          }}
        >
          Could not start checkout ({submit.detail}) — try again.
        </div>
      )}
    </form>
  );
}

function ProviderRadio({
  value,
  label,
  selected,
  onChange,
  disabled,
  variant,
}: {
  value: SponsorProvider;
  label: string;
  selected: SponsorProvider;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  variant: SponsorVariant;
}) {
  const id = `sponsor-provider-${variant}-${value}`;
  const isSelected = selected === value;
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 6,
        backgroundColor: isSelected ? "#1a1a24" : "transparent",
        border: `1px solid ${isSelected ? "#f4b942" : "#2a2a34"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? "#8f8fa8" : "#e4e4ef",
      }}
    >
      <input
        id={id}
        type="radio"
        name={`sponsor-provider-${variant}`}
        value={value}
        checked={isSelected}
        onChange={onChange}
        disabled={disabled}
        style={{ margin: 0 }}
      />
      <span style={{ fontSize: 15 }}>{label}</span>
    </label>
  );
}

export default SponsorForm;
