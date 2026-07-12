"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DonateCard } from "./DonateCard";
import { useCopy } from "@/components/CopyProvider";
import { flushPendingBibName } from "@/lib/pending-bib-save";

/**
 * SponsorForm
 *
 * Client-side custom-amount + provider CTA rendered inside a landing-page
 * section. Owns the slider ($1..$1000 in $1 steps) and the provider
 * picker (Stripe | Venmo). Phase 22-05 §22-05-04 introduces a
 * `variant` prop so the same component can back both the "Sponsor this
 * bib" section (POSTs /api/checkout/bib) and the "Just donate" section
 * (POSTs /api/checkout/general).
 *
 * On submit:
 *   - `stripe`   → POST /api/checkout/${variant}, redirect to Stripe URL.
 *   - `venmo`    → route to /sponsor/venmo?amount_cents=... (Plan 22-02).
 *
 * Design contract (v1.5 Phase 22 PLAN.md §22-01-02, extended by 22-05-04):
 * - Slider is a raw <input type="range" min={100} max={100000} step={100}>.
 * - Provider radio: Stripe default.
 *   - variant='bib' offers Stripe + Venmo.
 *   - variant='general' offers Stripe only for MVP.
 * - Amount display: `$XX.XX` (cents → dollars, 2dp).
 * - Login gate: this component renders inside the landing page which is
 *   behind full-app auth middleware. No client-side auth check.
 */

export const AMOUNT_MIN_CENTS = 100; //   $1.00 (absolute floor for clampAmountCents)
export const AMOUNT_MAX_CENTS = 200_000; // $2000.00 (Kurt 2026-07-04: raised from $1000)
export const AMOUNT_STEP_CENTS = 100; //   $1.00 steps

// Per-variant minimums + slider range (Kurt 2026-07-03). The slider covers the
// common range in $10 steps; the exact-amount input handles anything up to $1000.
export const BIB_MIN_CENTS = 2_000; //     $20 bib minimum
export const GENERAL_MIN_CENTS = 1_000; //  $10 donation minimum
export const SLIDER_MAX_CENTS = 20_000; //  $200 slider ceiling
export const SLIDER_STEP_CENTS = 1_000; //  $10 slider steps

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

/**
 * Clamp an amount (cents) into a variant's valid range: the per-variant
 * minimum ($20 bib / $10 general) floor and the global $2000 ceiling, snapped
 * to whole cents. Extracted (and shared with the component's `clampRange`) so
 * the checkout flow can be exercised in node without booting the DOM.
 */
export function clampForVariant(raw: number, variant: SponsorVariant): number {
  const minCents = variant === "bib" ? BIB_MIN_CENTS : GENERAL_MIN_CENTS;
  return Math.min(AMOUNT_MAX_CENTS, Math.max(minCents, clampAmountCents(raw)));
}

interface SubmitState {
  kind: "idle" | "submitting" | "error";
  detail?: string;
}

/**
 * Side-effect surface the checkout flow drives, injected so vitest can pin the
 * ordering (flush → checkout) without a DOM. In the component these map to the
 * pending-bib-save flusher, `fetch`, `router.push`, and `window.location`.
 */
export interface SponsorCheckoutDeps {
  /** Commit any unsaved bib name — MUST be awaited before checkout. */
  flush: () => Promise<void>;
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  /** Client-side provider handoff (Venmo / Cash App) — router.push. */
  navigate: (url: string) => void;
  /** Full-page redirect to the Stripe Checkout Session URL. */
  redirect: (url: string) => void;
  onSubmitting: () => void;
  onIdle: () => void;
  onError: (detail: string) => void;
}

/**
 * Implicit save-on-checkout (Plan 34-03, SC34.6). Guarantees the pending bib
 * name is flushed (awaited) BEFORE any checkout side-effect runs, for BOTH the
 * `bib` and `general` variants — so the bib prints the name the runner typed
 * even if they never clicked Save. Endpoints + provider routing are unchanged
 * (checkoutEndpointFor / providerRouteFor remain the single source of truth).
 */
export async function performSponsorCheckout(
  args: {
    variant: SponsorVariant;
    provider: SponsorProvider;
    amountCents: number;
    offerNonStripe: boolean;
  },
  deps: SponsorCheckoutDeps
): Promise<void> {
  // Commit any unsaved bib name FIRST — awaited so the PATCH lands before we
  // leave the page. Variant-agnostic: fires for bib AND general checkout.
  await deps.flush();

  const clamped = clampForVariant(args.amountCents, args.variant);

  // Non-Stripe: route to the provider instructions page (Plan 22-02).
  if (args.provider === "venmo" || args.provider === "cashapp") {
    if (!args.offerNonStripe) {
      // Defensive — the radio is hidden for variant='general' but guard here
      // in case a caller wires the state externally.
      deps.onError("unavailable for general donations");
      return;
    }
    deps.onIdle();
    deps.navigate(providerRouteFor(args.provider, clamped));
    return;
  }

  // Stripe: POST /api/checkout/${variant}, then redirect.
  deps.onSubmitting();
  try {
    const res = await deps.fetchImpl(checkoutEndpointFor(args.variant), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_cents: clamped, provider: "stripe" }),
    });

    if (!res.ok) {
      deps.onError(`HTTP ${res.status}`);
      return;
    }

    const body = (await res.json()) as { session_url?: string };
    if (!body.session_url) {
      deps.onError("missing session_url");
      return;
    }

    deps.redirect(body.session_url);
  } catch (err) {
    deps.onError(err instanceof Error ? err.message : "network");
  }
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
  /**
   * Runner code (BIB-XXXX) — when set, shows a copy-able runner-code badge
   * right above the CTA so runners include it in the Venmo / Cash App comment.
   */
  runnerCode?: string;
  /**
   * Force the whole form into a disabled, non-interactive state (all inputs,
   * pills, and the CTA). Used by the orderform to grey out the "Sponsor this
   * bib" tile once the runner has pledged to pay in person — the tile stays
   * on the page (swapped below "Just donate") instead of being removed.
   */
  disabled?: boolean;
}

export function SponsorForm({
  variant = "bib",
  ctaLabel,
  defaultAmountCents,
  runnerCode,
  disabled: forceDisabled = false,
}: SponsorFormProps = {}) {
  const router = useRouter();
  const { t } = useCopy();

  const minCents = variant === "bib" ? BIB_MIN_CENTS : GENERAL_MIN_CENTS;
  // Clamp into [variant minimum, $2000], snapping to whole cents. Delegates to
  // the shared clampForVariant so the picker and the checkout flow agree.
  const clampRange = useCallback(
    (raw: number) => clampForVariant(raw, variant),
    [variant]
  );

  const [amountCents, setAmountCents] = useState<number>(() =>
    clampRange(defaultAmountCents ?? minCents)
  );
  const [provider, setProvider] = useState<SponsorProvider>("stripe");
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });

  // Both bib + general offer Stripe / Venmo (Kurt 2026-07-03). Venmo doesn't
  // reconcile instantly — it surfaces once an admin approves the match.
  const offerNonStripe = true;

  // Amount comes back from DonateCard already $5-snapped; re-run the variant
  // clamp so the floor ($10/$20) + $2000 ceiling still hold before checkout.
  const onAmount = useCallback(
    (cents: number) => setAmountCents(clampRange(cents)),
    [clampRange]
  );

  // performSponsorCheckout commits any unsaved bib name (awaited) BEFORE any
  // checkout side-effect, for both variants (Kurt 2026-07-04, SC34.6).
  const runCheckout = useCallback(async () => {
    await performSponsorCheckout(
      { variant, provider, amountCents, offerNonStripe },
      {
        flush: flushPendingBibName,
        fetchImpl: (input, init) => fetch(input, init),
        navigate: (url) => router.push(url),
        redirect: (url) => {
          window.location.href = url;
        },
        onSubmitting: () => setSubmit({ kind: "submitting" }),
        onIdle: () => setSubmit({ kind: "idle" }),
        onError: (detail) => setSubmit({ kind: "error", detail }),
      }
    );
  }, [amountCents, provider, offerNonStripe, variant, router]);

  const resolvedCtaLabel =
    ctaLabel ??
    (variant === "bib"
      ? t("bib.contribution.sponsorVerb")
      : t("bib.contribution.donateVerb"));

  // Rendered bare — the orderform Sponsor tile already provides the card + the
  // title/art, so DonateCard drops its own chrome + title here.
  return (
    <DonateCard
      bare
      amountCents={amountCents}
      minCents={minCents}
      maxCents={AMOUNT_MAX_CENTS}
      onAmount={onAmount}
      provider={provider === "cashapp" ? "stripe" : provider}
      onProvider={setProvider}
      offerVenmo={offerNonStripe}
      runnerCode={runnerCode}
      submitting={submit.kind === "submitting"}
      disabled={forceDisabled}
      error={
        submit.kind === "error"
          ? t("bib.checkout.error", { detail: submit.detail ?? "" })
          : null
      }
      onSubmit={runCheckout}
      copy={{
        supportLabel: "Your support",
        title: "",
        subhead: "",
        stepHint: variant === "bib" ? "per bib · $5 steps" : "$5 steps",
        payWith: t("bib.checkout.paymentMethod"),
        card: t("bib.checkout.providerCard"),
        venmo: t("bib.checkout.providerVenmo"),
        venmoNote: t("bib.checkout.providerNote"),
        runnerLabel: "Runner",
        copyLabel: "Copy",
        copiedLabel: "Copied",
        payNow: resolvedCtaLabel,
        payShort: resolvedCtaLabel,
        roundUp: "round up +$5",
        redirecting: t("bib.checkout.redirecting"),
      }}
    />
  );
}

export default SponsorForm;
