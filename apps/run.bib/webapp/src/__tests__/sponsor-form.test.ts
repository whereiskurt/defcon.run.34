import { describe, it, expect } from "vitest";

/**
 * SponsorForm amount + provider routing unit tests (Plan 22-01-2).
 *
 * The SponsorForm component itself is a React client-component and its
 * DOM behavior is out of scope for the node-environment vitest config
 * (no jsdom on this project — see vitest.config.ts). What we pin here
 * are the pure helpers the component leans on:
 *
 *   - clampAmountCents(): boundary + snap + NaN behaviour
 *   - formatCentsUsd():   display shape ($X.XX)
 *   - providerRouteFor(): venmo / cashapp handoff URLs
 *
 * These functions are the load-bearing invariants Plan 22-01-3's
 * /api/checkout route depends on (min=100, max=100000, whole cents),
 * so any regression here would silently produce a 400 from Zod at the
 * API boundary or a bad Stripe Checkout price. Test the pure shape,
 * not the render.
 */

import {
  AMOUNT_MIN_CENTS,
  AMOUNT_MAX_CENTS,
  AMOUNT_STEP_CENTS,
  clampAmountCents,
  formatCentsUsd,
  providerRouteFor,
} from "@/components/SponsorForm";

describe("SponsorForm constants", () => {
  it("pins the $1..$1000 in $1-step design contract", () => {
    // These constants are the SINGLE source of truth for both the
    // <input type=range> attributes AND the /api/checkout Zod bounds
    // (min(100).max(100000)). Any drift between them will show up as
    // client-side clamped values that Zod rejects at the API layer.
    expect(AMOUNT_MIN_CENTS).toBe(100);
    expect(AMOUNT_MAX_CENTS).toBe(100_000);
    expect(AMOUNT_STEP_CENTS).toBe(100);
  });
});

describe("clampAmountCents()", () => {
  it("clamps a below-min value up to AMOUNT_MIN_CENTS", () => {
    expect(clampAmountCents(0)).toBe(AMOUNT_MIN_CENTS);
    expect(clampAmountCents(50)).toBe(AMOUNT_MIN_CENTS);
    expect(clampAmountCents(-500)).toBe(AMOUNT_MIN_CENTS);
  });

  it("clamps an above-max value down to AMOUNT_MAX_CENTS", () => {
    expect(clampAmountCents(150_000)).toBe(AMOUNT_MAX_CENTS);
    expect(clampAmountCents(1_000_000)).toBe(AMOUNT_MAX_CENTS);
  });

  it("snaps a fractional-step value down to the nearest step boundary", () => {
    // 4999¢ ($49.99) is above the 4900 step, below the 5000 step → 4900.
    expect(clampAmountCents(4999)).toBe(4900);
    expect(clampAmountCents(101)).toBe(100);
    expect(clampAmountCents(199)).toBe(100);
    expect(clampAmountCents(200)).toBe(200);
  });

  it("passes valid step-aligned values through unchanged", () => {
    expect(clampAmountCents(100)).toBe(100);
    expect(clampAmountCents(2500)).toBe(2500);
    expect(clampAmountCents(100_000)).toBe(100_000);
  });

  it("fail-safes NaN / Infinity to AMOUNT_MIN_CENTS (never $0)", () => {
    expect(clampAmountCents(Number.NaN)).toBe(AMOUNT_MIN_CENTS);
    expect(clampAmountCents(Number.POSITIVE_INFINITY)).toBe(AMOUNT_MIN_CENTS);
    expect(clampAmountCents(Number.NEGATIVE_INFINITY)).toBe(AMOUNT_MIN_CENTS);
  });
});

describe("formatCentsUsd()", () => {
  it("formats cents as $DD.CC with two decimal places", () => {
    expect(formatCentsUsd(100)).toBe("$1.00");
    expect(formatCentsUsd(2500)).toBe("$25.00");
    expect(formatCentsUsd(12345)).toBe("$123.00"); // 12345 snaps to 12300
    expect(formatCentsUsd(100_000)).toBe("$1000.00");
  });

  it("passes an above-max value through the clamp (never renders >$1000)", () => {
    // Guardrails against a Stripe Checkout Session with a runaway amount
    // from a broken slider event.
    expect(formatCentsUsd(999_999)).toBe("$1000.00");
  });
});

describe("providerRouteFor()", () => {
  it("routes venmo to /pay/venmo with the clamped amount query", () => {
    expect(providerRouteFor("venmo", 2500)).toBe("/pay/venmo?amount_cents=2500");
    // Fractional inputs get clamped/snapped in the URL too.
    expect(providerRouteFor("venmo", 4999)).toBe("/pay/venmo?amount_cents=4900");
  });

  it("routes cashapp to /pay/cashapp with the clamped amount query", () => {
    expect(providerRouteFor("cashapp", 2500)).toBe(
      "/pay/cashapp?amount_cents=2500"
    );
    expect(providerRouteFor("cashapp", 999_999)).toBe(
      "/pay/cashapp?amount_cents=100000"
    );
  });
});
