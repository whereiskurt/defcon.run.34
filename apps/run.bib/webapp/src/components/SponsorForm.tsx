"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AMOUNT_MAX_CENTS,
  AMOUNT_MIN_CENTS,
  AMOUNT_STEP_CENTS,
  clampAmountCents,
  formatCentsUsd,
} from "@/lib/amount";

/**
 * SponsorForm
 *
 * Client-side sponsor CTA below <BibForm />. Owns the custom-amount
 * slider ($1..$1000 in $1 steps) and the provider picker (Stripe |
 * Venmo | CashApp). On submit:
 *   - `stripe`   → POST /api/checkout, redirect to Stripe Checkout URL.
 *   - `venmo`    → route to /sponsor/venmo?amount_cents=... (Plan 22-02-1).
 *   - `cashapp`  → route to /sponsor/cashapp?amount_cents=... (Plan 22-02-2).
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-01-02 + Plan 22-02-3):
 * - Slider is a raw <input type="range" min={100} max={100000} step={100}>
 *   — cents-first (100 cents = $1). No HeroUI, no external UI lib.
 * - Provider radio: Stripe default. Venmo + CashApp handoff via
 *   `router.push()` (Next.js `useRouter`) so the basePath (`/use1` in
 *   prod) is applied automatically — avoids the raw-`window.location`
 *   basePath bug where an absolute path like `/sponsor/venmo` would
 *   miss the regional prefix and 404.
 * - Amount display: `$XX.XX` (cents → dollars, 2dp).
 * - No optimistic UX for Stripe — button disabled while POST is in
 *   flight, then browser navigates to Stripe. If POST fails, surface a
 *   compact error inline; the slider + provider stay editable so the
 *   user can retry.
 * - Login gate: this component only renders inside the landing page
 *   (`src/app/page.tsx`) which is behind the full-app auth middleware.
 *   No client-side auth check here — server already gated the render.
 *
 * Pure helpers (`clampAmountCents`, `formatCentsUsd`, amount constants)
 * live in `src/lib/amount.ts` so both this "use client" component AND
 * the server-rendered `/sponsor/{venmo,cashapp}` pages share the same
 * clamp + format contract. Re-exported here for backward compat with
 * the Plan 22-01-2 test import surface.
 */

export {
  AMOUNT_MAX_CENTS,
  AMOUNT_MIN_CENTS,
  AMOUNT_STEP_CENTS,
  clampAmountCents,
  formatCentsUsd,
};

export type SponsorProvider = "stripe" | "venmo" | "cashapp";

/**
 * Resolve the client-side handoff URL for a non-Stripe provider. This
 * is a RELATIVE path — `useRouter().push()` layers on the Next.js
 * basePath (e.g., `/use1`) so the browser lands on the correct
 * regional URL. Callers using raw `window.location.href` (not
 * recommended) MUST prepend the region themselves.
 *
 * Plan 22-02-1 + 22-02-2 land the actual `/sponsor/venmo` +
 * `/sponsor/cashapp` pages; this helper is the single source of
 * truth for those route strings.
 */
export function providerRouteFor(
  provider: Exclude<SponsorProvider, "stripe">,
  amountCents: number
): string {
  const clamped = clampAmountCents(amountCents);
  const path = provider === "venmo" ? "/sponsor/venmo" : "/sponsor/cashapp";
  return `${path}?amount_cents=${clamped}`;
}

interface SubmitState {
  kind: "idle" | "submitting" | "error";
  detail?: string;
}

export function SponsorForm() {
  const router = useRouter();
  const [amountCents, setAmountCents] = useState<number>(2000); // $20 default
  const [provider, setProvider] = useState<SponsorProvider>("stripe");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  const displayAmount = useMemo(
    () => formatCentsUsd(amountCents),
    [amountCents]
  );

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
      // Use Next.js `router.push` so the basePath (e.g., `/use1` in prod)
      // is applied automatically — a raw `window.location.href` on an
      // absolute path would drop the regional prefix and 404.
      if (provider === "venmo" || provider === "cashapp") {
        setSubmit({ kind: "idle" });
        router.push(providerRouteFor(provider, clamped));
        return;
      }

      // Stripe: POST /api/checkout/bib, then redirect to Stripe Checkout URL.
      // Phase 22-05: renamed from /api/checkout when the two-product split
      // landed. Task 22-05-04 further refactors this component into a
      // variant-driven two-endpoint router.
      setSubmit({ kind: "submitting" });
      try {
        const res = await fetch("/api/checkout/bib", {
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
    [amountCents, provider, router]
  );

  const disabled = submit.kind === "submitting";

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Sponsor amount and provider"
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
          Sponsor amount
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
        htmlFor="sponsor-amount-slider"
        style={{
          fontSize: 13,
          color: "#a4a4b8",
        }}
      >
        Drag to choose an amount ($1 to $1000)
      </label>
      <input
        id="sponsor-amount-slider"
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
        />
        <ProviderRadio
          value="venmo"
          label="Venmo"
          selected={provider}
          onChange={onProviderChange}
          disabled={disabled}
        />
        <ProviderRadio
          value="cashapp"
          label="Cash App"
          selected={provider}
          onChange={onProviderChange}
          disabled={disabled}
        />
      </fieldset>

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
        {disabled ? "Redirecting…" : `Sponsor ${displayAmount}`}
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
}: {
  value: SponsorProvider;
  label: string;
  selected: SponsorProvider;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
}) {
  const id = `sponsor-provider-${value}`;
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
        name="sponsor-provider"
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
