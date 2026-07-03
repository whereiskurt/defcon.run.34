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

/**
 * Preset dollar amounts offered as one-click chips (Kurt 2026-07-02
 * feedback: replace the raw slider with quick-pick chips + a free-form
 * input, weighted toward lower values). Users who want an amount
 * outside these presets use the "custom" input.
 */
export const AMOUNT_PRESETS_DOLLARS = [
  5, 10, 15, 20, 25, 40, 50, 75, 100, 200, 250,
] as const;

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

  // Both bib + general offer Stripe / Venmo / CashApp (Kurt 2026-07-03).
  // Venmo/CashApp don't reconcile instantly — they surface for the runner
  // only after an admin approves the match.
  const offerNonStripe = true;

  const onCustomChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      // Free-form dollar input — strip anything but digits + one dot,
      // parse as float, convert to cents, then clamp.
      const raw = event.target.value.replace(/[^0-9.]/g, "");
      const dollars = Number.parseFloat(raw);
      if (!Number.isFinite(dollars)) {
        setAmountCents(AMOUNT_MIN_CENTS);
        return;
      }
      setAmountCents(clampAmountCents(Math.round(dollars * 100)));
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
            color: "#6CCDB8",
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

      {/* Slider across the full range — cleaner than a wall of preset chips
        * (Kurt 2026-07-03). The custom input below allows an exact amount. */}
      <input
        type="range"
        min={AMOUNT_MIN_CENTS}
        max={AMOUNT_MAX_CENTS}
        step={AMOUNT_STEP_CENTS}
        value={amountCents}
        onChange={(e) => setAmountCents(clampAmountCents(Number(e.target.value)))}
        disabled={disabled}
        aria-label={variant === "bib" ? "Sponsor amount" : "Donation amount"}
        style={{
          width: "100%",
          accentColor: "#6CCDB8",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "#8f8fa8",
          marginTop: -12,
          fontFamily:
            "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
        }}
      >
        <span>$1</span>
        <span>$1000</span>
      </div>

      <label
        htmlFor={`sponsor-amount-custom-${variant}`}
        style={{
          fontSize: 13,
          color: "#a4a4b8",
        }}
      >
        Or type an exact amount ($1&ndash;$1000)
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 12px",
          backgroundColor: "#1a1a24",
          border: "1px solid #2a2a34",
          borderRadius: 6,
          maxWidth: 180,
        }}
      >
        <span style={{ color: "#8f8fa8", fontWeight: 700 }}>$</span>
        <input
          id={`sponsor-amount-custom-${variant}`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={(amountCents / 100).toString()}
          onChange={onCustomChange}
          disabled={disabled}
          aria-label="Custom amount in US dollars"
          style={{
            flex: 1,
            minWidth: 0,
            padding: 0,
            fontSize: 16,
            fontWeight: 700,
            color: "#e4e4ef",
            backgroundColor: "transparent",
            border: "none",
            outline: "none",
            fontFamily:
              "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
          }}
        />
      </div>

      {offerNonStripe && (
        <div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#8f8fa8",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Payment method
          </span>
          {/* One-line row of provider pills with little brand icons. */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <ProviderPill
              value="stripe"
              label="Card"
              icon={<ProviderIcon color="#635BFF" glyph="S" />}
              selected={provider}
              onSelect={setProvider}
              disabled={disabled}
            />
            <ProviderPill
              value="cashapp"
              label="Cash App"
              icon={<ProviderIcon color="#00D632" glyph="$" />}
              selected={provider}
              onSelect={setProvider}
              disabled={disabled}
            />
            <ProviderPill
              value="venmo"
              label="Venmo"
              icon={<ProviderIcon color="#3D95CE" glyph="V" />}
              selected={provider}
              onSelect={setProvider}
              disabled={disabled}
            />
          </div>
          {(provider === "venmo" || provider === "cashapp") && (
            <p style={{ fontSize: 12, color: "#a4a4b8", margin: "8px 0 0" }}>
              Venmo &amp; Cash App are confirmed by an organizer — your
              contribution appears once approved.
            </p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={disabled}
        style={{
          padding: "14px 20px",
          fontSize: 16,
          fontWeight: 700,
          color: "#0a0a0a",
          backgroundColor: disabled ? "#8f8fa8" : "#6CCDB8",
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

/** Small brand-colored icon badge (little Stripe / Cash App / Venmo mark). */
function ProviderIcon({ color, glyph }: { color: string; glyph: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: 5,
        backgroundColor: color,
        color: "#fff",
        fontSize: 11,
        fontWeight: 800,
        fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
}

/** One-line selectable payment-method pill (icon + label). */
function ProviderPill({
  value,
  label,
  icon,
  selected,
  onSelect,
  disabled,
}: {
  value: SponsorProvider;
  label: string;
  icon: React.ReactNode;
  selected: SponsorProvider;
  onSelect: (p: SponsorProvider) => void;
  disabled: boolean;
}) {
  const isSelected = selected === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      disabled={disabled}
      aria-pressed={isSelected}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 8,
        backgroundColor: isSelected ? "#1a1a24" : "transparent",
        border: `1px solid ${isSelected ? "#6CCDB8" : "#2a2a34"}`,
        color: disabled ? "#8f8fa8" : "#e4e4ef",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      {icon}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </button>
  );
}

export default SponsorForm;
